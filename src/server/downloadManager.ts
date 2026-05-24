/* ────────────────────────────────────────────────────────────────
 *  Download manager - queues chart downloads, extracts .sng files
 *  into the Clone Hero songs directory, and cleans song.ini tags.
 * ──────────────────────────────────────────────────────────────── */

import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID, createHash } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ReadableStream } from 'stream/web';
import sanitize from 'sanitize-filename';

import { config } from './configStore.js';
import { getChartDownloadStream } from './enchor.js';
import { cleanAllSongInis } from './songIniCleaner.js';
import { loadDownloads, scheduleSave, scanSongsDir } from './persistence.js';
import { enrichSingle, needsEnrichment } from './enrichment.js';
import type { DownloadProgress, ChartResult } from '../shared/types';

// ── In-memory state ─────────────────────────────────────────────

const queue: Map<string, DownloadProgress> = new Map();
let processing = false;
const pendingMd5s: string[] = [];

// ── Startup init ────────────────────────────────────────────────

/**
 * Call once at server startup. Loads persisted download history;
 * falls back to scanning the songs directory if history is empty.
 * Re-scans if existing scanned items are missing chart data (upgrade path).
 */
export async function initQueue(): Promise<void> {
  const saved = await loadDownloads();

  if (saved.size > 0) {
    // Check if scanned items need upgrading (no chart data from older version)
    const needsRescan = [...saved.values()].some(
      dp => dp.md5.startsWith('scan-') && !dp.chart,
    );

    if (needsRescan && config.cloneHeroSongsDir) {
      // Re-scan to pick up enriched metadata; keep real (non-scan) downloads
      const scanned = await scanAllSongDirs();
      const scanMap = new Map(scanned.map(dp => [dp.md5, dp]));
      // Merge: prefer freshly scanned data for scan-* items, keep real downloads
      for (const [k, v] of saved) {
        if (k.startsWith('scan-')) {
          // Match by destinationPath since md5 is derived from folder name
          const fresh = scanMap.get(k);
          queue.set(k, fresh ?? v);
          if (fresh) scanMap.delete(k);
        } else {
          queue.set(k, v);
        }
      }
      // Add any new scanned songs not in the saved data
      for (const [k, dp] of scanMap) queue.set(k, dp);
      scheduleSave(queue);
    } else {
      for (const [k, v] of saved) queue.set(k, v);
    }
    return;
  }

  // First run or empty DB - scan songs dirs as a starting point
  if (config.cloneHeroSongsDir) {
    const scanned = await scanAllSongDirs();
    for (const dp of scanned) queue.set(dp.md5, dp);
    scheduleSave(queue);
  }
}

/** Enrich a single download entry on-demand (called when user expands a card). */
export async function enrichSingleDownload(md5: string): Promise<boolean> {
  const dp = queue.get(md5);
  if (!dp || !needsEnrichment(dp)) return false;

  const match = await enrichSingle(dp);
  if (!match) return false;

  dp.chart = match;
  dp.albumArtMd5 = match.albumArtMd5 ?? dp.albumArtMd5;
  broadcast(dp);
  return true;
}

/** Server-Sent Events listeners - each connected client gets a push. */
const sseListeners: Set<(data: DownloadProgress) => void> = new Set();

export function subscribeSSE(listener: (data: DownloadProgress) => void) {
  sseListeners.add(listener);
  return () => { sseListeners.delete(listener); };
}

function broadcast(dp: DownloadProgress) {
  queue.set(dp.md5, dp);
  scheduleSave(queue);
  for (const fn of sseListeners) fn(dp);
}

export function getQueueSnapshot(): DownloadProgress[] {
  return [...queue.values()];
}

// ── Public API ──────────────────────────────────────────────────

export interface DownloadOptions {
  format: 'sng' | 'folder';
  skipVideo: boolean;
}

const DEFAULT_DL_OPTS: DownloadOptions = { format: 'folder', skipVideo: true };

const pendingOpts: Map<string, DownloadOptions> = new Map();
const pendingCharts: Map<string, ChartResult> = new Map();
const pendingUrlJobs: Map<string, string> = new Map(); // md5 key → source URL

export function enqueueDownload(
  chart: ChartResult,
  opts: DownloadOptions = DEFAULT_DL_OPTS,
  addedBy?: DownloadProgress['addedBy'],
) {
  if (queue.has(chart.md5) && queue.get(chart.md5)!.status !== 'error') {
    return; // already queued or done
  }

  const dp: DownloadProgress = {
    md5: chart.md5,
    name: chart.name ?? 'Unknown',
    artist: chart.artist ?? 'Unknown',
    charter: chart.charter ?? 'Unknown',
    status: 'queued',
    percent: null,
    albumArtMd5: chart.albumArtMd5 ?? null,
    chart,
    addedBy,
  };

  broadcast(dp);
  pendingMd5s.push(chart.md5);
  pendingOpts.set(chart.md5, opts);
  pendingCharts.set(chart.md5, chart);
  processQueue();
}

export function removeDownload(md5: string) {
  queue.delete(md5);
  const idx = pendingMd5s.indexOf(md5);
  if (idx !== -1) pendingMd5s.splice(idx, 1);
  scheduleSave(queue);
}

/**
 * Scan the user's songs directory AND the Clone Hero built-in songs directory
 * ({installDir}/Clone Hero_Data/StreamingAssets/songs).
 */
async function scanAllSongDirs(): Promise<DownloadProgress[]> {
  const songsDir = config.cloneHeroSongsDir;
  if (!songsDir) return [];

  // Clone Hero_Data is a sibling of the Songs folder
  const defaultDir = path.join(path.dirname(songsDir), 'Clone Hero_Data', 'StreamingAssets', 'songs');
  const toScan = [scanSongsDir(songsDir), scanSongsDir(defaultDir)];

  const results = await Promise.all(toScan);
  return results.flat();
}

/** Full sync of the queue against the songs directory on disk. */
export async function rescanLibrary(): Promise<DownloadProgress[]> {
  if (!config.cloneHeroSongsDir) return getQueueSnapshot();
  const scanned = await scanAllSongDirs();

  // Paths that physically exist on disk right now
  const diskPaths = new Set(
    scanned.map(dp => dp.destinationPath).filter(Boolean) as string[]
  );

  // Remove done entries whose folder was deleted from disk
  for (const [key, dp] of queue) {
    if (dp.status === 'done' && dp.destinationPath && !diskPaths.has(dp.destinationPath)) {
      queue.delete(key);
    }
  }

  // Deduplicate: if multiple queue entries share a destinationPath keep the
  // non-scan- one (real Enchor md5 carries more metadata).
  const pathToKey = new Map<string, string>();
  for (const [key, dp] of queue) {
    if (dp.status !== 'done' || !dp.destinationPath) continue;
    const prev = pathToKey.get(dp.destinationPath);
    if (!prev) {
      pathToKey.set(dp.destinationPath, key);
    } else if (key.startsWith('scan-')) {
      queue.delete(key);
    } else if (prev.startsWith('scan-')) {
      queue.delete(prev);
      pathToKey.set(dp.destinationPath, key);
    }
  }

  // Paths already covered by surviving queue entries
  const coveredPaths = new Set(
    [...queue.values()]
      .filter(dp => dp.status === 'done' && dp.destinationPath)
      .map(dp => dp.destinationPath as string)
  );

  // Add newly discovered songs not yet tracked
  for (const dp of scanned) {
    if (dp.destinationPath && !coveredPaths.has(dp.destinationPath)) {
      queue.set(dp.md5, dp);
    }
  }

  scheduleSave(queue);
  return getQueueSnapshot();
}

/** Download and install a chart from a direct URL (zip or sng). */
export function enqueueUrlDownload(
  url: string,
  addedBy?: DownloadProgress['addedBy'],
) {
  const key = 'url-' + createHash('md5').update(url).digest('hex').slice(0, 12);
  if (queue.has(key) && queue.get(key)!.status !== 'error') return;

  const filename = url.split('/').pop()?.split('?')[0] ?? 'chart';
  const dp: DownloadProgress = {
    md5: key,
    name: filename,
    artist: 'URL Import',
    charter: '—',
    status: 'queued',
    percent: null,
    addedBy,
  };

  broadcast(dp);
  pendingMd5s.push(key);
  pendingOpts.set(key, DEFAULT_DL_OPTS);
  pendingUrlJobs.set(key, url);
  processQueue();
}

// ── Internal queue runner ───────────────────────────────────────

const MAX_RETRIES = 3;

async function processQueue() {
  if (processing) return;
  processing = true;

  while (pendingMd5s.length > 0) {
    const md5 = pendingMd5s.shift()!;
    const dp = queue.get(md5);
    if (!dp) continue;
    const opts = pendingOpts.get(md5) ?? DEFAULT_DL_OPTS;
    pendingOpts.delete(md5);
    const chart = pendingCharts.get(md5);
    pendingCharts.delete(md5);
    if (!chart) continue;

    let lastErr: unknown;
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const srcUrl = pendingUrlJobs.get(md5);
        if (attempt === 1) pendingUrlJobs.delete(md5);
        if (srcUrl) {
          await downloadAndInstallFromUrl(md5, dp, srcUrl, opts);
        } else {
          await downloadAndInstall(md5, dp, chart, opts);
        }
        succeeded = true;
        break;
      } catch (err: unknown) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          const delay = attempt * 2000;
          console.warn(`  ⚠  Download attempt ${attempt}/${MAX_RETRIES} failed for "${dp.name}": ${err instanceof Error ? err.message : err}. Retrying in ${delay / 1000}s…`);
          broadcast({ ...dp, status: 'downloading', percent: null, error: `Retrying… (attempt ${attempt + 1}/${MAX_RETRIES})` });
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    if (!succeeded) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      broadcast({ ...dp, status: 'error', error: msg });
    }
  }

  processing = false;
}

async function downloadAndInstall(
  md5: string,
  dp: DownloadProgress,
  chart: ChartResult,
  opts: DownloadOptions,
) {
  const songsDir = config.cloneHeroSongsDir;
  if (!songsDir) throw new Error('CLONE_HERO_SONGS_DIR is not configured');

  // Build folder name: "Artist - Song (Charter)"
  const folderName = sanitize(
    `${chart.artist ?? 'Unknown'} - ${chart.name ?? 'Unknown'} (${chart.charter ?? 'Unknown'})`,
    { replacement: '_' },
  );
  const destDir = path.join(songsDir, folderName);
  const destSng = path.join(songsDir, `${folderName}.sng`);
  const destPath = opts.format === 'sng' ? destSng : destDir;

  // Check for duplicates
  try {
    await fs.access(destPath);
    throw new Error('Chart already exists in library');
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'Chart already exists in library') throw e;
    // ENOENT is expected - doesn't exist yet, good
  }

  // ── Download the .sng file to a temp path ──────────────────
  broadcast({ ...dp, status: 'downloading', percent: 0 });

  const tmpDir = path.join(os.tmpdir(), `clone-sidekick-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const sngPath = path.join(tmpDir, `${md5}.sng`);

  // Only request the _novideo variant when the chart actually has a video
  // background AND the user wants to skip it; otherwise the _novideo file
  // doesn't exist on enchor.us and we'd get a 404.
  const actuallySkipVideo = opts.skipVideo && (chart.hasVideoBackground === true);
  const { body, contentLength } = await getChartDownloadStream(md5, actuallySkipVideo);

  // Stream to disk via pipeline (handles backpressure + error propagation)
  // while tracking progress via a passthrough counter.
  let downloaded = 0;
  const nodeStream = Readable.fromWeb(body as ReadableStream<Uint8Array>);
  nodeStream.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    const pct = contentLength > 0
      ? Math.round((downloaded / contentLength) * 100)
      : null;
    broadcast({ ...dp, status: 'downloading', percent: pct });
  });
  await pipeline(nodeStream, createWriteStream(sngPath));

  // Integrity check: if the server told us the size, verify we got it all
  if (contentLength > 0) {
    const { size } = await fs.stat(sngPath);
    if (size !== contentLength) {
      throw new Error(`Download incomplete: received ${size} of ${contentLength} bytes`);
    }
  }

  // ── Install chart ──────────────────────────────────────────
  broadcast({ ...dp, status: 'extracting', percent: null });

  if (opts.format === 'sng') {
    // Keep as .sng — just copy to songs dir
    await fs.copyFile(sngPath, destSng);
  } else {
    // Extract .sng → chart folder
    await fs.mkdir(destDir, { recursive: true });

    // .sng is the primary format from enchor.us. Try parse-sng first;
    // fall back to ZIP only if parse-sng is unavailable (import error),
    // which means some older charts were shipped as plain zips.
    try {
      await extractSng(sngPath, destDir);
    } catch (sngErr: unknown) {
      const msg = sngErr instanceof Error ? sngErr.message : String(sngErr);
      // Only ZIP-fallback when parse-sng itself is missing, not when extraction fails
      if (msg.includes('Cannot find') || msg.includes('MODULE_NOT_FOUND')) {
        await extractZip(sngPath, destDir);
      } else {
        throw new Error(`Failed to extract chart: ${msg}`);
      }
    }

    // ── Clean song.ini ────────────────────────────────────────
    await cleanAllSongInis(destDir);
  }

  // ── Cleanup temp ──────────────────────────────────────────
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  // ── YARG dual-install ──────────────────────────────────────
  const yargDir = config.yargSongsDir;
  if (yargDir) {
    try {
      if (opts.format === 'sng') {
        await fs.copyFile(destSng, path.join(yargDir, `${folderName}.sng`));
      } else {
        await fs.cp(destDir, path.join(yargDir, folderName), { recursive: true });
      }
    } catch { /* non-fatal — CH install already succeeded */ }
  }

  broadcast({
    ...dp,
    status: 'done',
    percent: 100,
    destinationPath: destPath,
    downloadedAt: new Date().toISOString(),
    chart,
  });
}

// ── .sng extraction helpers ─────────────────────────────────────

async function extractSng(sngPath: string, destDir: string) {
  // Dynamically import parse-sng - it may not be installed
  const { SngStream } = await import('parse-sng');
  const fileBuffer = await fs.readFile(sngPath);

  // Create a ReadableStream from the buffer
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(fileBuffer);
      controller.close();
    },
  });

  const sngStream = new SngStream(readable as any, { generateSongIni: true });

  await new Promise<void>((resolve, reject) => {
    sngStream.on('file', async (fileName: string, fileStream: any, nextFile: (() => void) | null) => {
      const outPath = path.join(destDir, fileName);
      await fs.mkdir(path.dirname(outPath), { recursive: true });

      const nodeStream = Readable.fromWeb(fileStream as ReadableStream<Uint8Array>);
      const ws = createWriteStream(outPath);
      await pipeline(nodeStream, ws);

      if (nextFile) nextFile();
      else resolve();
    });

    sngStream.on('error', (err: unknown) => reject(err));
    sngStream.start();
  });
}

async function downloadAndInstallFromUrl(
  key: string,
  dp: DownloadProgress,
  url: string,
  opts: DownloadOptions,
) {
  const songsDir = config.cloneHeroSongsDir;
  if (!songsDir) throw new Error('CLONE_HERO_SONGS_DIR is not configured');

  broadcast({ ...dp, status: 'downloading', percent: 0 });

  const tmpDir = path.join(os.tmpdir(), `clone-sidekick-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  // Detect extension from URL path (before any query string)
  const urlPath = new URL(url).pathname;
  const ext = path.extname(urlPath).toLowerCase() || '.sng';
  const tmpFile = path.join(tmpDir, `download${ext}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);

  let downloaded = 0;
  const nodeStream = Readable.fromWeb(res.body as ReadableStream<Uint8Array>);
  nodeStream.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    const pct = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : null;
    broadcast({ ...dp, status: 'downloading', percent: pct });
  });
  await pipeline(nodeStream, createWriteStream(tmpFile));

  if (contentLength > 0) {
    const { size } = await fs.stat(tmpFile);
    if (size !== contentLength) {
      throw new Error(`Download incomplete: received ${size} of ${contentLength} bytes`);
    }
  }

  broadcast({ ...dp, status: 'extracting', percent: null });

  // Use the URL filename (without extension) as the folder name
  const baseName = sanitize(path.basename(urlPath, ext) || key, { replacement: '_' });

  const destDir2 = path.join(songsDir, baseName);
  const destSng2 = path.join(songsDir, `${baseName}.sng`);
  const destPath = opts.format === 'sng' ? destSng2 : destDir2;

  if (opts.format === 'sng') {
    await fs.copyFile(tmpFile, destSng2);
  } else {
    await fs.mkdir(destDir2, { recursive: true });
    if (ext === '.sng') {
      try {
        await extractSng(tmpFile, destDir2);
      } catch (sngErr: unknown) {
        const msg = sngErr instanceof Error ? sngErr.message : String(sngErr);
        if (msg.includes('Cannot find') || msg.includes('MODULE_NOT_FOUND')) {
          await extractZip(tmpFile, destDir2);
        } else {
          throw new Error(`Failed to extract chart: ${msg}`);
        }
      }
    } else {
      await extractZip(tmpFile, destDir2);
    }
    await cleanAllSongInis(destDir2);
  }

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  const yargDir = config.yargSongsDir;
  if (yargDir) {
    try {
      if (opts.format === 'sng') {
        await fs.copyFile(destSng2, path.join(yargDir, `${baseName}.sng`));
      } else {
        await fs.cp(destDir2, path.join(yargDir, baseName), { recursive: true });
      }
    } catch { /* non-fatal */ }
  }

  broadcast({
    ...dp,
    status: 'done',
    percent: 100,
    destinationPath: destPath,
    downloadedAt: new Date().toISOString(),
  });
}

async function extractZip(zipPath: string, destDir: string) {
  // Use yauzl-promise for zip extraction
  const yauzl = await import('yauzl-promise');
  const zip = await yauzl.open(zipPath);

  try {
    for await (const entry of zip) {
      if (entry.filename.endsWith('/')) {
        await fs.mkdir(path.join(destDir, entry.filename), { recursive: true });
        continue;
      }

      const outPath = path.join(destDir, entry.filename);
      await fs.mkdir(path.dirname(outPath), { recursive: true });

      const readStream = await entry.openReadStream();
      const ws = createWriteStream(outPath);
      await pipeline(readStream, ws);
    }
  } finally {
    await zip.close();
  }
}
