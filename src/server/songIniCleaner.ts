/* ────────────────────────────────────────────────────────────────
 *  song.ini cleaner - removes group / crew tags from metadata.
 *
 *  Many charters add tags like "(Wavegroup)", "[CSC]", "(GHC)" to
 *  the artist (or name) fields.  These are visual noise in-game.
 *  This module strips those tags on every download automatically.
 * ──────────────────────────────────────────────────────────────── */

import fs from 'fs/promises';
import path from 'path';

/**
 * Regex that matches common group / crew / charter tags:
 *   (Wavegroup)  [CSC]  (GHC)  {SomeTag}  etc.
 *
 * It catches any parenthesised / bracketed / braced token that
 * contains only letters, digits, spaces, dashes, and underscores
 * - i.e. things that look like tags, not real song-title content.
 */
const GROUP_TAG_RE = /\s*[\(\[\{][A-Za-z0-9 _\-]+[\)\]\}]\s*/g;

/**
 * Strips Clone Hero / Unity rich-text markup from a string.
 * Handles: <color=#hex>, </color>, <b>, </b>, <i>, </i>,
 *          <size=N>, </size>, and any other short <x> tags used in CH.
 */
export function stripRichText(value: string): string {
  return value
    .replace(/<color=[^>]*>/gi, '')
    .replace(/<\/color>/gi, '')
    .replace(/<size=[^>]*>/gi, '')
    .replace(/<\/size>/gi, '')
    .replace(/<\/?[biqsnc]>/gi, '')   // <b> <i> <q> <s> <n> <c> and closing variants
    .replace(/<[^>]{1,20}>/g, '')     // catch-all for any remaining short tags
    .trim();
}

/** Keys in song.ini that should have group tags stripped. */
const KEYS_TO_CLEAN: ReadonlySet<string> = new Set([
  'artist',
  'name',
  'album',
  'genre',
  'charter',         // sometimes charters tag their own name
  'frets',           // older ini files use this instead of "charter"
]);

/**
 * Read the song.ini at `iniPath`, strip group tags from the
 * relevant fields, and write the cleaned version back.
 *
 * Returns the number of fields that were modified.
 */
export async function cleanSongIni(iniPath: string): Promise<number> {
  const raw = await fs.readFile(iniPath, 'utf-8');
  let changed = 0;

  const cleaned = raw
    .split(/\r?\n/)
    .map(line => {
      // song.ini lines look like:  key = value
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) return line;

      const key = line.slice(0, eqIdx).trim().toLowerCase();
      if (!KEYS_TO_CLEAN.has(key)) return line;

      const before = line.slice(eqIdx + 1);
      const after = stripRichText(before.replace(GROUP_TAG_RE, ' '));

      if (after !== before.trim()) {
        changed++;
        // preserve original key casing + spacing style
        return `${line.slice(0, eqIdx + 1)} ${after}`;
      }
      return line;
    })
    .join('\n');

  if (changed > 0) {
    await fs.writeFile(iniPath, cleaned, 'utf-8');
  }

  return changed;
}

/**
 * Walk `dir` looking for any song.ini files and clean them all.
 * Returns total number of fields modified across all ini files found.
 */
export async function cleanAllSongInis(dir: string): Promise<number> {
  let total = 0;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await cleanAllSongInis(full);
    } else if (entry.name.toLowerCase() === 'song.ini') {
      total += await cleanSongIni(full);
    }
  }

  return total;
}
