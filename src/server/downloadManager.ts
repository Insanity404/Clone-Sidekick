/* ────────────────────────────────────────────────────────────────
 *  Download manager - queues chart downloads, extracts .sng files
 *  into the Clone Hero songs directory, and cleans song.ini tags.
 * ──────────────────────────────────────────────────────────────── */

import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ReadableStream } from 'stream/web';
import sanitize from 'sanitize-filename';

import { config } from './configStore.js';
import { getChartDownloadStream } from './enchor.js';
import { cleanAllSongInis } from './songIniCleaner.js';
import { loadDownloads, scheduleSave, scanSongsDir } from './persistence.js';
import { enrichSingle, needsEnrichment } from './enrichment.js';
import type { DownloadProgress, DownloadStatus, ChartResult, UserInfo } from '../shared/types';

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
      const scanned = await scanSongsDir(config.cloneHeroSongsDir);
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

  // First run or empty DB - scan songs dir as a starting point
  if (config.cloneHeroSongsDir) {
    const scanned = await scanSongsDir(config.cloneHeroSongsDir);
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

// ── Internal queue runner ───────────────────────────────────────

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

    try {
      await downloadAndInstall(md5, dp, chart, opts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
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

  // Write .sng to disk while tracking progress
  let downloaded = 0;
  const nodeStream = Readable.fromWeb(body as ReadableStream<Uint8Array>);

  const progressStream = new Readable({
    read() { /* pumped externally */ },
  });

  // Pipe through a transform that tracks bytes
  const writeStream = createWriteStream(sngPath);
  await new Promise<void>((resolve, reject) => {
    nodeStream.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      const pct = contentLength > 0
        ? Math.round((downloaded / contentLength) * 100)
        : null;
      broadcast({ ...dp, status: 'downloading', percent: pct });
      writeStream.write(chunk);
    });
    nodeStream.on('end', () => { writeStream.end(); resolve(); });
    nodeStream.on('error', reject);
    writeStream.on('error', reject);
  });

  // ── Install chart ──────────────────────────────────────────
  broadcast({ ...dp, status: 'extracting', percent: null });

  if (opts.format === 'sng') {
    // Keep as .sng — just copy to songs dir
    await fs.copyFile(sngPath, destSng);
  } else {
    // Extract .sng → chart folder
    await fs.mkdir(destDir, { recursive: true });

    // .sng is actually a custom container format. We try using parse-sng first.
    // If parse-sng isn't available, fall back to treating the .sng as a zip.
    try {
      await extractSng(sngPath, destDir);
    } catch {
      // Fallback: try extracting as a zip archive
      await extractZip(sngPath, destDir);
    }

    // ── Clean song.ini ────────────────────────────────────────
    await cleanAllSongInis(destDir);
  }

  // ── Cleanup temp ──────────────────────────────────────────
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

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
