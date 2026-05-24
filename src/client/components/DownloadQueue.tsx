import { useState, useRef, useEffect, Component, type ReactNode } from 'react';
import { cancelDownload, deleteDownload, enrichDownload, getSongCount, localArtUrl, albumArtUrl, downloadFromUrl } from '../api';
import type { DownloadProgress } from '../../shared/types';
import type { ChartPreviewPlayer } from 'chart-preview';
import 'chart-preview';
import { InstrumentBadgeRow, INST_DEFS } from './InstrumentBadges';

// ── Error Boundary (prevents full-page crash from web component) ─

class PreviewErrorBoundary extends Component<
  { children: ReactNode; onError: (msg: string) => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error) { this.props.onError(err.message); }
  render() { return this.state.hasError ? null : this.props.children; }
}

type SortKey = 'newest' | 'oldest' | 'artist' | 'name' | 'status';

/** Strip Clone Hero rich-text markup for display. */
function stripRichText(s: string): string {
  return s
    .replace(/<color=[^>]*>/gi, '')
    .replace(/<\/color>/gi, '')
    .replace(/<size=[^>]*>/gi, '')
    .replace(/<\/size>/gi, '')
    .replace(/<\/?[biqsnc]>/gi, '')
    .replace(/<[^>]{1,20}>/g, '')
    .trim();
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'artist', label: 'Artist A–Z' },
  { value: 'name',   label: 'Song A–Z' },
  { value: 'status', label: 'Status' },
];

function sortDownloads(items: DownloadProgress[], key: SortKey): DownloadProgress[] {
  const copy = [...items];

  // Errors and in-progress items always float to the top
  const priority = (dp: DownloadProgress) =>
    dp.status === 'error' ? 0
    : dp.status === 'downloading' ? 1
    : dp.status === 'extracting' ? 2
    : dp.status === 'queued' ? 3
    : 4; // done

  const baseCompare = (a: DownloadProgress, b: DownloadProgress): number => {
    switch (key) {
      case 'newest': return (b.downloadedAt ?? '').localeCompare(a.downloadedAt ?? '');
      case 'oldest': return (a.downloadedAt ?? '').localeCompare(b.downloadedAt ?? '');
      case 'artist': return a.artist.localeCompare(b.artist);
      case 'name':   return a.name.localeCompare(b.name);
      case 'status': return a.status.localeCompare(b.status);
    }
  };

  return copy.sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return baseCompare(a, b);
  });
}

export function DownloadQueue({
  downloads,
  onRemove,
}: {
  downloads: Map<string, DownloadProgress>;
  onRemove: (md5: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [songCount, setSongCount] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    getSongCount().then(r => setSongCount(r.count)).catch(() => {});
  }, [downloads.size]);

  const handleCancel = async (md5: string) => {
    try { await cancelDownload(md5); onRemove(md5); } catch { /* ignore */ }
  };

  const handleDelete = async (md5: string) => {
    try { await deleteDownload(md5); onRemove(md5); } catch { /* ignore */ }
  };

  const handleUrlDownload = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setUrlBusy(true);
    setUrlError('');
    try {
      await downloadFromUrl(url);
      setUrlInput('');
      setUrlOpen(false);
    } catch (e: unknown) {
      setUrlError(e instanceof Error ? e.message : 'Failed to start download');
    }
    setUrlBusy(false);
  };

  const allItems = [...downloads.values()];
  const sorted = sortDownloads(allItems, sortKey);
  const activeItems = sorted.filter(dp => dp.status !== 'done');
  const doneItems   = sorted.filter(dp => dp.status === 'done');

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-400">
          {songCount !== null ? `Songs: ${songCount.toLocaleString()}` : 'Songs'}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setUrlOpen(o => !o); setUrlError(''); }}
            className="text-xs px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
          >
            📥 From URL
          </button>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs
                       text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* URL install panel */}
      {urlOpen && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-2">
          <p className="text-xs text-gray-400">
            Paste a direct link to a <code className="text-purple-400">.sng</code> or <code className="text-purple-400">.zip</code> chart pack.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={e => { setUrlInput(e.target.value); setUrlError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleUrlDownload()}
              placeholder="https://example.com/chart.zip"
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={handleUrlDownload}
              disabled={urlBusy || !urlInput.trim()}
              className="shrink-0 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-sm text-white rounded-lg transition"
            >
              {urlBusy ? '…' : 'Download'}
            </button>
          </div>
          {urlError && <p className="text-xs text-red-400">{urlError}</p>}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">📦</div>
          <p className="text-sm">No downloads yet.</p>
          <p className="text-xs mt-1">Search for a song and hit the download button!</p>
        </div>
      ) : (
        <>
          {/* ── Active / queued items ─────────────────────── */}
          {activeItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">In Progress</span>
                <span className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 text-xs font-medium">
                  {activeItems.length}
                </span>
              </div>
              {activeItems.map(dp => (
                <DownloadItem
                  key={dp.md5}
                  item={dp}
                  onCancel={() => handleCancel(dp.md5)}
                  onDelete={() => handleDelete(dp.md5)}
                />
              ))}
            </div>
          )}

          {/* ── Completed items ───────────────────────────── */}
          {doneItems.length > 0 && (
            <div className="space-y-2">
              {activeItems.length > 0 && (
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">History</span>
              )}
              {doneItems.map(dp => (
                <DownloadItem
                  key={dp.md5}
                  item={dp}
                  onCancel={() => handleCancel(dp.md5)}
                  onDelete={() => handleDelete(dp.md5)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function DownloadItem({
  item,
  onCancel,
  onDelete,
  readOnly = false,
  defaultExpanded = false,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
}: {
  item: DownloadProgress;
  onCancel?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
  defaultExpanded?: boolean;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  // SRB = Clone Hero built-in song; use the bundled icon as album art
  const artUrl = item.md5.startsWith('srb-')
    ? '/cloneHeroIcon.webp'
    : item.status === 'done'
      ? localArtUrl(item.md5)
      : albumArtUrl(item.albumArtMd5 ?? null);

  const statusColors: Record<string, string> = {
    queued:      'text-gray-400',
    downloading: 'text-blue-400',
    extracting:  'text-yellow-400',
    done:        'text-green-400',
    error:       'text-red-400',
  };

  const statusIcons: Record<string, string> = {
    queued:      '⏳',
    downloading: '⬇️',
    extracting:  '📦',
    done:        '✅',
    error:       '❌',
  };

  const chart = item.chart;
  const duration = chart?.song_length ? formatMs(chart.song_length) : null;

  return (
    <div className={`bg-gray-900 border rounded-xl transition ${
      selectMode && isSelected ? 'border-purple-600 hover:border-purple-500' : 'border-gray-800 hover:border-gray-700'
    }`}>
      {/* ── Collapsed row ──────────────────────────── */}
      <div
        className="p-3 cursor-pointer"
        onClick={() => selectMode ? (item.status === 'done' && onToggleSelect?.()) : setExpanded(e => !e)}
      >
        {/* Main row */}
        <div className="flex gap-3">
          {/* Album art */}
          <div className="shrink-0 w-14 h-14 sm:w-20 sm:h-20 rounded-lg bg-gray-800 overflow-hidden">
            {artUrl ? (
              <img
                src={artUrl}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl text-gray-600">
                {item.status === 'done' ? '🎵' : statusIcons[item.status] ?? '🎵'}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm sm:text-base leading-tight truncate">
              {item.name}
            </h3>
            <p className="text-xs sm:text-sm text-gray-400 truncate">
              {item.artist}
              {chart?.album ? ` — ${chart.album}` : ''}
            </p>

            {/* Status row (only for in-progress items) */}
            {item.status !== 'done' && (
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-medium ${statusColors[item.status]}`}>
                  {statusIcons[item.status]}{' '}
                  {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                </span>
                {item.percent != null && item.status === 'downloading' && (
                  <div className="flex-1 max-w-32 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                )}
                {item.error && (
                  <span className="text-xs text-red-400 truncate">{item.error}</span>
                )}
              </div>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
              <span title="Charter">🎤 {stripRichText(item.charter)}</span>
              {chart?.genre && <span>{chart.genre}</span>}
              {chart?.year && <span>{chart.year}</span>}
              {duration && <span>{duration}</span>}
            </div>
          </div>

          {/* Right: desktop badges + action controls */}
          <div className="shrink-0 flex items-start gap-2">
            {/* Badges - desktop only, hidden in select mode */}
            {chart && !selectMode && (
              <div className="hidden sm:block">
                <InstrumentBadgeRow chart={chart} className="justify-end" />
              </div>
            )}
            {/* Checkbox (select mode) or action buttons */}
            {selectMode ? (
              <div
                className="flex items-center justify-center self-center p-1"
                onClick={e => { e.stopPropagation(); if (item.status === 'done') onToggleSelect?.(); }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={item.status !== 'done'}
                  onChange={() => {}}
                  className="w-5 h-5 accent-purple-500 cursor-pointer disabled:opacity-30 pointer-events-none"
                />
              </div>
            ) : !readOnly ? (
              <div onClick={e => e.stopPropagation()}>
                {(item.status === 'queued' || item.status === 'error') && (
                  <button
                    onClick={onCancel}
                    className="text-gray-500 hover:text-red-400 transition p-1"
                    title="Remove"
                  >
                    <XIcon />
                  </button>
                )}
                {item.status === 'done' && (
                  confirmDelete ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-red-400">Delete?</span>
                      <button onClick={onDelete} className="text-red-500 hover:text-red-300 transition p-1" title="Confirm delete">
                        <TrashIcon />
                      </button>
                      <button onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:text-gray-300 transition p-1" title="Cancel">
                        <XIcon />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="text-gray-600 hover:text-red-400 transition p-1"
                      title="Delete song files from disk"
                    >
                      <TrashIcon />
                    </button>
                  )
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Mobile badge footer row */}
        {chart && !selectMode && (
          <div className="sm:hidden flex gap-3 mt-2">
            <div className="w-14 shrink-0" />
            <InstrumentBadgeRow chart={chart} className="justify-start" large={true} />
          </div>
        )}
      </div>

      {/* ── Expanded detail panel ──────────────────── */}
      {expanded && <DownloadExpandedPanel item={item} />}
    </div>
  );
}

function DownloadExpandedPanel({ item }: { item: DownloadProgress }) {
  const [showPreview, setShowPreview] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const chart = item.chart;
  const nd = chart?.notesData;

  // SRB songs are Clone Hero built-ins - no Enchor.us data to fetch
  const needsEnrich = item.status === 'done' && !item.md5.startsWith('srb-') && (!chart || (chart.chartId === 0 && !nd));

  useEffect(() => {
    if (!needsEnrich) return;
    let cancelled = false;
    setEnriching(true);
    enrichDownload(item.md5)
      .finally(() => { if (!cancelled) setEnriching(false); });
    return () => { cancelled = true; };
  }, [item.md5, needsEnrich]);

  const features: { label: string; value: boolean | null | undefined }[] = chart ? [
    { label: 'Solo Sections',    value: nd?.hasSoloSections },
    { label: 'Lyrics',           value: nd?.hasLyrics ?? chart.hasLyrics },
    { label: 'Vocals',           value: nd?.hasVocals ?? chart.hasVocals },
    { label: 'Forced Notes',     value: nd?.hasForcedNotes },
    { label: 'Tap Notes',        value: nd?.hasTapNotes },
    { label: 'Open Notes',       value: nd?.hasOpenNotes },
    { label: '2x Kick',          value: nd?.has2xKick },
    { label: 'Flex Lanes',       value: nd?.hasFlexLanes },
    { label: 'Video Background', value: chart.hasVideoBackground },
  ] : [];

  const defaultInstrument = chart
    ? (INST_DEFS.find(d => (chart as any)[d.diffKey] != null && (chart as any)[d.diffKey] >= 0)?.key ?? 'guitar')
    : 'guitar';

  // Use enriched chart's real Enchor md5 for preview; SRB/scan items have no Enchor data
  const previewMd5 = chart && chart.chartId !== 0 ? chart.md5
    : !item.md5.startsWith('scan-') && !item.md5.startsWith('srb-') ? item.md5
    : null;

  return (
    <div className="border-t border-gray-800 px-4 pb-4 pt-3 space-y-3">
      {/* Loading indicator for on-demand enrichment */}
      {enriching && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full" />
          Loading chart details…
        </div>
      )}
      {/* ── Features grid ─────────────────────────────── */}
      {chart && features.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Features</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5">
            {features.map(f => (
              <div key={f.label} className="flex items-center gap-1.5 text-xs">
                {f.value == null ? (
                  <span className="text-gray-600">—</span>
                ) : f.value ? (
                  <span className="text-green-400">✓</span>
                ) : (
                  <span className="text-gray-600">✗</span>
                )}
                <span className={f.value ? 'text-gray-300' : 'text-gray-600'}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Extra metadata ────────────────────────────── */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        {chart?.loading_phrase && <span title="Loading phrase">💬 {chart.loading_phrase}</span>}
        {chart?.modifiedTime && (
          <span title="Last modified">📅 {new Date(chart.modifiedTime).toLocaleDateString()}</span>
        )}
        {item.downloadedAt && (
          <span>⬇️ Downloaded {new Date(item.downloadedAt).toLocaleDateString()}</span>
        )}
        {item.destinationPath && (
          <span className="truncate max-w-full" title={item.destinationPath}>📁 {item.destinationPath}</span>
        )}
      </div>

      {/* ── Note counts per instrument ────────────────── */}
      {nd && nd.noteCounts.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Note Counts</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-xs">
            {nd.noteCounts.map(nc => (
              <div key={`${nc.instrument}-${nc.difficulty}`} className="flex justify-between text-gray-400">
                <span>{nc.instrument} {nc.difficulty}</span>
                <span className="text-gray-300 font-mono">{nc.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Chart Preview ─────────────────────────────── */}
      {previewMd5 && (
        !showPreview ? (
          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-2 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-600/40 rounded-lg text-sm text-purple-300 transition"
          >
            <PlayIcon />
            Chart Preview
          </button>
        ) : (
          <DownloadChartPreviewWrapper
            md5={previewMd5}
            instrument={defaultInstrument}
            hasVideoBackground={chart?.hasVideoBackground ?? false}
            previewStartTime={chart?.preview_start_time ?? null}
            songLength={chart?.song_length ?? null}
          />
        )
      )}
    </div>
  );
}

function DownloadChartPreviewWrapper(props: {
  md5: string;
  instrument: string;
  hasVideoBackground: boolean;
  previewStartTime: number | null;
  songLength: number | null;
}) {
  const [boundaryError, setBoundaryError] = useState<string | null>(null);

  if (boundaryError) {
    return <p className="text-xs text-red-400 py-2">Chart preview failed: {boundaryError}</p>;
  }

  return (
    <PreviewErrorBoundary onError={setBoundaryError}>
      <DownloadChartPreview {...props} />
    </PreviewErrorBoundary>
  );
}

function DownloadChartPreview({ md5, instrument, hasVideoBackground, previewStartTime, songLength }: {
  md5: string;
  instrument: string;
  hasVideoBackground: boolean;
  previewStartTime: number | null;
  songLength: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ChartPreviewPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Use _novideo for charts with video - the 3D highway doesn't render video backgrounds
  const sngUrl = `https://files.enchor.us/${md5}${hasVideoBackground ? '_novideo' : ''}.sng`;
  const seekPercent = previewStartTime != null && songLength
    ? previewStartTime / songLength
    : 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abortCtrl = new AbortController();

    const player = document.createElement('chart-preview-player') as ChartPreviewPlayer;
    player.setAttribute('volume', '50');
    player.style.display = 'block';
    player.style.width = '100%';
    player.style.height = '100%';
    container.appendChild(player);
    playerRef.current = player;

    const handleError = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setError(detail?.error?.message ?? 'Chart preview failed');
      setLoading(false);
    };
    player.addEventListener('player-error', handleError);

    const handleStateChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.state === 'ready' || detail?.state === 'playing') {
        setLoading(false);
      }
    };
    player.addEventListener('player-statechange', handleStateChange);

    player.loadFromUrl({
      url: sngUrl,
      instrument: instrument as any,
      difficulty: 'expert',
      initialSeekPercent: seekPercent,
      signal: abortCtrl.signal,
    }).then(() => {
      if (!abortCtrl.signal.aborted) {
        player.play().catch(() => {});
      }
    }).catch((e: any) => {
      if (!abortCtrl.signal.aborted) {
        setError(e?.message ?? 'Failed to load chart preview');
        setLoading(false);
      }
    });

    return () => {
      abortCtrl.abort();
      player.removeEventListener('player-error', handleError);
      player.removeEventListener('player-statechange', handleStateChange);
      try { player.dispose(); } catch { /* ignore */ }
      container.removeChild(player);
      playerRef.current = null;
    };
  }, [sngUrl, instrument, seekPercent]);

  return (
    <div className="space-y-1">
      <div className="rounded-lg overflow-hidden bg-black aspect-video relative">
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full" />
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

// ── Shared helpers ──────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
