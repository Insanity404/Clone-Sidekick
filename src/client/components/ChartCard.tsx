import { useState, useRef, useEffect, Component, type ReactNode } from 'react';
import { albumArtUrl } from '../api';
import type { ChartResult } from '../../shared/types';
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

interface ChartCardProps {
  chart: ChartResult;
  onDownload: () => void;
  isDownloading: boolean;
  isDownloaded: boolean;
  hasSimilarVersion?: boolean;
}

export function ChartCard({ chart, onDownload, isDownloading, isDownloaded, hasSimilarVersion }: ChartCardProps) {
  const [expanded, setExpanded] = useState(false);
  const artUrl = albumArtUrl(chart.albumArtMd5);
  const duration = chart.song_length ? formatMs(chart.song_length) : null;

  return (
    <div className={`bg-gray-900 border rounded-xl transition ${
      isDownloaded
        ? 'border-gray-800 hover:border-gray-700'
        : hasSimilarVersion
          ? 'border-amber-900/50 hover:border-amber-800/70'
          : 'border-gray-800 hover:border-gray-700'
    }`}>
      {/* ── Collapsed row ──────────────────────────── */}
      <div
        className="p-3 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Main row */}
        <div className="flex gap-3">
          {/* Album art */}
          <div className="shrink-0 w-14 h-14 sm:w-20 sm:h-20 rounded-lg bg-gray-800 overflow-hidden">
            {artUrl ? (
              <img src={artUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl text-gray-600">🎵</div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm sm:text-base leading-tight truncate">
              {chart.name ?? 'Unknown Song'}
            </h3>
            <p className="text-xs sm:text-sm text-gray-400 truncate">
              {chart.artist ?? 'Unknown Artist'}
              {chart.album ? ` — ${chart.album}` : ''}
            </p>
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
              {chart.charter && <span title="Charter">🎤 {chart.charter}</span>}
              {chart.genre && <span>{chart.genre}</span>}
              {chart.year && <span>{chart.year}</span>}
              {duration && <span>{duration}</span>}
            </div>
          </div>

          {/* Right: desktop badges + controls on same row */}
          <div className="shrink-0 flex items-start gap-2">
            {/* Badges — desktop only */}
            <div className="hidden sm:block">
              <InstrumentBadgeRow chart={chart} className="justify-end" />
            </div>
            {/* Controls */}
            <div className="flex items-center gap-1.5">
              {hasSimilarVersion && (
                <span
                  title="You already have a version of this song"
                  className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 cursor-help"
                >
                  <SimilarIcon />
                </span>
              )}
              <button
                onClick={e => { e.stopPropagation(); if (!isDownloaded) onDownload(); }}
                disabled={isDownloading || isDownloaded}
                className={`shrink-0 rounded-lg p-2 transition ${
                  isDownloaded
                    ? 'bg-green-700/30 text-green-400 cursor-default'
                    : isDownloading
                      ? 'bg-gray-700/50 text-gray-400 cursor-default'
                      : 'bg-purple-600 hover:bg-purple-500 text-white active:scale-95'
                }`}
                title={isDownloaded ? 'Already in library' : isDownloading ? 'Downloading...' : 'Download to Clone Hero'}
              >
                {(isDownloaded || isDownloading) ? <CheckIcon /> : <DownloadIcon />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile badge footer row */}
        <div className="sm:hidden flex gap-3 mt-2">
          <div className="w-14 shrink-0" />
          <InstrumentBadgeRow chart={chart} className="justify-start" large />
        </div>
      </div>

      {/* ── Expanded detail panel ──────────────────── */}
      {expanded && <ExpandedPanel chart={chart} />}
    </div>
  );
}

// ── Expanded detail panel ───────────────────────────────────────

function ExpandedPanel({ chart }: { chart: ChartResult }) {
  const [showPreview, setShowPreview] = useState(false);

  const nd = chart.notesData;

  const features: { label: string; value: boolean | null | undefined }[] = [
    { label: 'Solo Sections',    value: nd?.hasSoloSections },
    { label: 'Lyrics',           value: nd?.hasLyrics ?? chart.hasLyrics },
    { label: 'Vocals',           value: nd?.hasVocals ?? chart.hasVocals },
    { label: 'Forced Notes',     value: nd?.hasForcedNotes },
    { label: 'Tap Notes',        value: nd?.hasTapNotes },
    { label: 'Open Notes',       value: nd?.hasOpenNotes },
    { label: '2x Kick',          value: nd?.has2xKick },
    { label: 'Flex Lanes',       value: nd?.hasFlexLanes },
    { label: 'Video Background', value: chart.hasVideoBackground },
  ];

  const defaultInstrument = INST_DEFS.find(
    d => (chart as any)[d.diffKey] != null && (chart as any)[d.diffKey] >= 0
  )?.key ?? 'guitar';

  return (
    <div className="border-t border-gray-800 px-4 pb-4 pt-3 space-y-3">
      {/* ── Features grid ─────────────────────────────── */}
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

      {/* ── Extra metadata ────────────────────────────── */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        {chart.loading_phrase && <span title="Loading phrase">💬 {chart.loading_phrase}</span>}
        {chart.modifiedTime && (
          <span title="Last modified">📅 {new Date(chart.modifiedTime).toLocaleDateString()}</span>
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
      {!showPreview ? (
        <button
          onClick={() => setShowPreview(true)}
          className="flex items-center gap-2 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-600/40 rounded-lg text-sm text-purple-300 transition"
        >
          <PlayIcon />
          Chart Preview
        </button>
      ) : (
        <ChartPreviewWrapper chart={chart} instrument={defaultInstrument} />
      )}
    </div>
  );
}

// ── Chart preview with error boundary wrapper ──────────────────

function ChartPreviewWrapper({ chart, instrument }: { chart: ChartResult; instrument: string }) {
  const [boundaryError, setBoundaryError] = useState<string | null>(null);

  if (boundaryError) {
    return <p className="text-xs text-red-400 py-2">Chart preview failed: {boundaryError}</p>;
  }

  return (
    <PreviewErrorBoundary onError={setBoundaryError}>
      <ChartPreview chart={chart} instrument={instrument} />
    </PreviewErrorBoundary>
  );
}

function ChartPreview({ chart, instrument }: { chart: ChartResult; instrument: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ChartPreviewPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Use _novideo for charts with video - the 3D highway doesn't render video backgrounds
  const sngUrl = `https://files.enchor.us/${chart.md5}${chart.hasVideoBackground ? '_novideo' : ''}.sng`;
  const seekPercent = chart.preview_start_time != null && chart.song_length
    ? chart.preview_start_time / chart.song_length
    : 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abortCtrl = new AbortController();

    // Create the web component imperatively so we control its lifecycle
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

// ── Helpers ─────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function SimilarIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13" />
      <circle cx="6" cy="19" r="3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="16" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
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
