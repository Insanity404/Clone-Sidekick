/* ────────────────────────────────────────────────────────────────
 *  Download history persistence - JSON file in data/downloads.json
 *
 *  On first run (or if the file is empty) we fall back to scanning
 *  the Clone Hero songs directory and treating every folder found
 *  as a completed download.
 * ──────────────────────────────────────────────────────────────── */

import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import type { DownloadProgress, ChartResult } from '../shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'downloads.json');

// ── Load ────────────────────────────────────────────────────────

export async function loadDownloads(): Promise<Map<string, DownloadProgress>> {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf-8');
    const arr: DownloadProgress[] = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return new Map();
    const map = new Map<string, DownloadProgress>();
    for (const dp of arr) map.set(dp.md5, dp);
    return map;
  } catch {
    return new Map();
  }
}

// ── Save (debounced) ────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSave(queue: Map<string, DownloadProgress>): void {
  if (saveTimer) clearTimeout(saveTimer);
  // Snapshot the values now so later mutations don't affect this write
  const snapshot = [...queue.values()];
  saveTimer = setTimeout(() => persistNow(snapshot), 500);
}

async function persistNow(entries: DownloadProgress[]): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(entries, null, 2), 'utf-8');
  } catch { /* best-effort, never crash the server */ }
}

// ── Songs-dir scanner (fallback) ────────────────────────────────

/**
 * Walk the top level of `songsDir`, find each song folder, parse
 * its song.ini for metadata, and return a list of fake "done"
 * DownloadProgress entries so the download page isn't empty.
 */
export async function scanSongsDir(songsDir: string): Promise<DownloadProgress[]> {
  const results: DownloadProgress[] = [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(songsDir, { withFileTypes: true }) as Dirent[];
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(songsDir, entry.name);

    // Read folder modification time as approximate download date
    let downloadedAt: string | undefined;
    try {
      const stat = await fs.stat(folderPath);
      downloadedAt = stat.mtime.toISOString();
    } catch { /* ignore */ }

    const iniPath = await findSongIni(folderPath);
    const meta = iniPath
      ? parseSongIni(await fs.readFile(iniPath, 'utf-8').catch(() => ''))
      : {};

    // Use a stable hash of the folder name as the key (no real md5 available)
    const key = 'scan-' + createHash('md5').update(entry.name).digest('hex').slice(0, 12);

    // Build a partial ChartResult from song.ini so the UI can display
    // instruments, genre, year, album, and difficulty info on the card.
    const chart = buildChartFromIni(meta, key);

    results.push({
      md5: key,
      name: meta['name'] ?? entry.name,
      artist: meta['artist'] ?? 'Unknown',
      charter: meta['charter'] ?? meta['frets'] ?? 'Unknown',
      status: 'done',
      percent: 100,
      destinationPath: folderPath,
      downloadedAt,
      chart,
    });
  }

  return results;
}

// ── Helpers ─────────────────────────────────────────────────────

/** Extract a numeric diff value from song.ini (returns null if missing or -1). */
function iniDiff(meta: Record<string, string>, key: string): number | null {
  const v = meta[key];
  if (v == null) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

/** Build a partial ChartResult from song.ini metadata so the UI can show
 *  instruments, genre, year, album, loading phrase, etc. on scanned songs. */
function buildChartFromIni(meta: Record<string, string>, md5: string): ChartResult {
  return {
    chartId: 0,
    songId: null,
    groupId: 0,
    name: meta['name'] ?? null,
    artist: meta['artist'] ?? null,
    album: meta['album'] ?? null,
    genre: meta['genre'] ?? null,
    year: meta['year'] ?? null,
    charter: meta['charter'] ?? meta['frets'] ?? null,
    song_length: meta['song_length'] ? parseInt(meta['song_length'], 10) || null : null,
    md5,
    chartHash: '',
    albumArtMd5: null,
    modifiedTime: '',
    hasVideoBackground: false,
    diff_guitar: iniDiff(meta, 'diff_guitar'),
    diff_guitar_coop: iniDiff(meta, 'diff_guitar_coop'),
    diff_rhythm: iniDiff(meta, 'diff_rhythm'),
    diff_bass: iniDiff(meta, 'diff_bass'),
    diff_drums: iniDiff(meta, 'diff_drums'),
    diff_drums_real: iniDiff(meta, 'diff_drums_real'),
    diff_keys: iniDiff(meta, 'diff_keys'),
    diff_guitarghl: iniDiff(meta, 'diff_guitarghl'),
    diff_guitar_coop_ghl: iniDiff(meta, 'diff_guitar_coop_ghl'),
    diff_rhythm_ghl: iniDiff(meta, 'diff_rhythm_ghl'),
    diff_bassghl: iniDiff(meta, 'diff_bassghl'),
    diff_vocals: iniDiff(meta, 'diff_vocals'),
    diff_band: iniDiff(meta, 'diff_band'),
    loading_phrase: meta['loading_phrase'] ?? null,
    icon: meta['icon'] ?? null,
    preview_start_time: meta['preview_start_time'] ? parseInt(meta['preview_start_time'], 10) || null : null,
  };
}

async function findSongIni(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase() === 'song.ini') {
        return path.join(dir, e.name);
      }
    }
    // One level deep - some charters nest files in a subfolder
    for (const e of entries) {
      if (e.isDirectory()) {
        const nested = await findSongIni(path.join(dir, e.name));
        if (nested) return nested;
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return null;
}

function parseSongIni(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    result[key] = val;
  }
  return result;
}
