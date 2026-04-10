/* ────────────────────────────────────────────────────────────────
 *  Enchor.us proxy - search & download helpers.
 * ──────────────────────────────────────────────────────────────── */

import type { SearchRequest, SearchResponse, AdvancedSearchRequest } from '../shared/types';

const API_BASE = 'https://api.enchor.us';
export const FILES_BASE = 'https://files.enchor.us';

/** Proxy a general search to Enchor.us and return the JSON result. */
export async function searchCharts(body: SearchRequest): Promise<SearchResponse> {
  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      source: 'api',
      per_page: body.per_page ?? 25,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Enchor.us search failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<SearchResponse>;
}

/** Proxy an advanced search to Enchor.us and return the JSON result. */
export async function advancedSearchCharts(body: AdvancedSearchRequest): Promise<SearchResponse> {
  const res = await fetch(`${API_BASE}/advancedSearch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      source: 'api',
      per_page: body.per_page ?? 25,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Enchor.us advanced search failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<SearchResponse>;
}

/** Return a Node readable stream for the .sng file of the given chart MD5. */
export async function getChartDownloadStream(md5: string, skipVideo = false) {
  const url = `${FILES_BASE}/${md5}${skipVideo ? '_novideo' : ''}.sng`;
  const res = await fetch(url, {
    headers: {
      mode: 'cors',
      'referrer-policy': 'no-referrer',
    },
  });

  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) for ${md5}`);
  }

  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
  return { body: res.body, contentLength };
}
