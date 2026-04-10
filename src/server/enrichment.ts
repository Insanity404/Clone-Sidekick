/* ────────────────────────────────────────────────────────────────
 *  On-demand enrichment — searches Enchor.us for a single download
 *  entry that is missing full chart data and backfills it.
 *  Called lazily when the user expands a card on the Downloads page.
 * ──────────────────────────────────────────────────────────────── */

import { searchCharts } from './enchor.js';
import type { DownloadProgress, ChartResult } from '../shared/types';

/** Returns true if a download entry would benefit from an Enchor lookup. */
export function needsEnrichment(dp: DownloadProgress): boolean {
  if (dp.status !== 'done') return false;
  const c = dp.chart;
  if (!c) return true;
  if (c.chartId === 0 && !c.notesData) return true;
  return false;
}

/**
 * Search Enchor.us for a matching chart for the given download entry.
 * Returns the matched ChartResult, or null if no match found.
 */
export async function enrichSingle(dp: DownloadProgress): Promise<ChartResult | null> {
  if (!needsEnrichment(dp)) return dp.chart ?? null;

  const name = dp.name.trim();
  const artist = dp.artist.trim();

  if (!name || name === 'Unknown') return null;

  const query = artist && artist !== 'Unknown'
    ? `${artist} ${name}`
    : name;

  const response = await searchCharts({
    search: query,
    page: 1,
    per_page: 5,
  });

  if (!response.data || response.data.length === 0) return null;

  const normalize = (s: string | null | undefined) =>
    (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const nName = normalize(name);
  const nArtist = normalize(artist);
  const nCharter = normalize(dp.charter);

  for (const chart of response.data) {
    const cName = normalize(chart.name);
    const cArtist = normalize(chart.artist);
    const cCharter = normalize(chart.charter);

    if (cName !== nName || cArtist !== nArtist) continue;

    if (nCharter && nCharter !== 'unknown' && cCharter === nCharter) {
      return chart;
    }

    return chart;
  }

  return null;
}
