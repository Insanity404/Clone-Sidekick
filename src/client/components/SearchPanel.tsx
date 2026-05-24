import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { search as apiSearch, advancedSearch as apiAdvancedSearch, startDownload, getPrefs, savePrefs } from '../api';
import { ChartCard } from './ChartCard';
import { useToast } from './Toast';
import type {
  SearchRequest,
  SearchResponse,
  ChartResult,
  Instrument,
  Difficulty,
  AdvancedSearchRequest,
  TextFilter,
  DownloadFormat,
  DownloadProgress,
} from '../../shared/types';
import { INSTRUMENTS, DIFFICULTIES } from '../../shared/types';

const PER_PAGE = 25;

const emptyText = (): TextFilter => ({ value: '', exact: false, exclude: false });

function normTitle(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
}

export function SearchPanel({
  downloads,
  onDownloadQueued,
}: {
  downloads: Map<string, DownloadProgress>;
  onDownloadQueued?: (chart: ChartResult) => void;
}) {
  const downloadedMd5s = useMemo(
    () => new Set([...downloads.values()].filter(d => d.status === 'done').map(d => d.md5)),
    [downloads],
  );

  // md5s for items currently in-flight (queued/downloading/extracting) — used to block duplicate downloads
  const inProgressMd5s = useMemo(
    () => new Set(
      [...downloads.values()]
        .filter(d => d.status === 'queued' || d.status === 'downloading' || d.status === 'extracting')
        .map(d => d.md5),
    ),
    [downloads],
  );

  // Key: "name||artist" for every non-error download — used for fuzzy duplicate detection
  const downloadedNameKeys = useMemo(
    () => new Set(
      [...downloads.values()]
        .filter(d => d.status !== 'error' && d.name)
        .map(d => `${normTitle(d.name)}||${normTitle(d.artist)}`),
    ),
    [downloads],
  );
  const [query, setQuery] = useState('');
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [emhxOnly, setEmhxOnly] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>('folder');
  const [downloadVideoBackground, setDownloadVideoBackground] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [results, setResults] = useState<ChartResult[]>([]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [advancedMode, setAdvancedMode] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Advanced search state
  const [advName, setAdvName] = useState<TextFilter>(emptyText());
  const [advArtist, setAdvArtist] = useState<TextFilter>(emptyText());
  const [advAlbum, setAdvAlbum] = useState<TextFilter>(emptyText());
  const [advGenre, setAdvGenre] = useState<TextFilter>(emptyText());
  const [advYear, setAdvYear] = useState<TextFilter>(emptyText());
  const [advCharter, setAdvCharter] = useState<TextFilter>(emptyText());

  const [minLength, setMinLength] = useState('');
  const [maxLength, setMaxLength] = useState('');
  const [minIntensity, setMinIntensity] = useState('');
  const [maxIntensity, setMaxIntensity] = useState('');
  const [minAverageNPS, setMinAverageNPS] = useState('');
  const [maxAverageNPS, setMaxAverageNPS] = useState('');
  const [minMaxNPS, setMinMaxNPS] = useState('');
  const [maxMaxNPS, setMaxMaxNPS] = useState('');
  const [minYearNum, setMinYearNum] = useState('');
  const [maxYearNum, setMaxYearNum] = useState('');
  const [modifiedAfter, setModifiedAfter] = useState('');

  const [hasForcedNotes, setHasForcedNotes] = useState<boolean | null>(null);
  const [hasOpenNotes, setHasOpenNotes] = useState<boolean | null>(null);
  const [hasTapNotes, setHasTapNotes] = useState<boolean | null>(null);
  const [hasSoloSections, setHasSoloSections] = useState<boolean | null>(null);
  const [hasLyrics, setHasLyrics] = useState<boolean | null>(null);
  const [hasVocals, setHasVocals] = useState<boolean | null>(null);
  const [hasRollLanes, setHasRollLanes] = useState<boolean | null>(null);
  const [has2xKick, setHas2xKick] = useState<boolean | null>(null);
  const [hasIssues, setHasIssues] = useState<boolean | null>(null);
  const [hasVideoBackground, setHasVideoBackground] = useState<boolean | null>(null);
  const [modchart, setModchart] = useState<boolean | null>(null);

  // Load saved prefs on mount
  useEffect(() => {
    getPrefs()
      .then(p => {
        setInstrument((p.instrument as Instrument) ?? null);
        setDifficulty((p.difficulty as Difficulty) ?? null);
        setEmhxOnly(p.emhxOnly);
        setDownloadFormat(p.downloadFormat ?? 'folder');
        setDownloadVideoBackground(p.downloadVideoBackground ?? false);
      })
      .catch(() => { /* use defaults */ })
      .finally(() => setPrefsLoaded(true));
  }, []);

  // Debounced save whenever prefs change (skip before loaded to avoid overwriting)
  useEffect(() => {
    if (!prefsLoaded) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      savePrefs({ instrument, difficulty, emhxOnly, downloadFormat, downloadVideoBackground }).catch(() => {});
    }, 600);
    return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
  }, [instrument, difficulty, emhxOnly, downloadFormat, downloadVideoBackground, prefsLoaded]);

  const doSearch = useCallback(
    async (pageNum = 1, append = false) => {
      setLoading(true);
      setError(null);
      if (!append) {
        setResults([]);
        setResponse(null);
      }
      try {
        let res: SearchResponse;
        if (advancedMode) {
          const optNum = (v: string) => v ? Number(v) : null;
          const body: AdvancedSearchRequest = {
            page: pageNum,
            per_page: PER_PAGE,
            instrument,
            difficulty: emhxOnly ? 'easy' : difficulty,
            name: advName,
            artist: advArtist,
            album: advAlbum,
            genre: advGenre,
            year: advYear,
            charter: advCharter,
            minLength: optNum(minLength),
            maxLength: optNum(maxLength),
            minIntensity: optNum(minIntensity),
            maxIntensity: optNum(maxIntensity),
            minAverageNPS: optNum(minAverageNPS),
            maxAverageNPS: optNum(maxAverageNPS),
            minMaxNPS: optNum(minMaxNPS),
            maxMaxNPS: optNum(maxMaxNPS),
            minYear: optNum(minYearNum),
            maxYear: optNum(maxYearNum),
            modifiedAfter: modifiedAfter || null,
            hasForcedNotes,
            hasOpenNotes,
            hasTapNotes,
            hasSoloSections,
            hasLyrics,
            hasVocals,
            hasRollLanes,
            has2xKick,
            hasIssues,
            hasVideoBackground,
            modchart,
          };
          res = await apiAdvancedSearch(body);
        } else {
          const body: SearchRequest = {
            search: query || '*',
            page: pageNum,
            per_page: PER_PAGE,
            instrument,
            difficulty: emhxOnly ? 'easy' : difficulty,
          };
          res = await apiSearch(body);
        }
        setResponse(res);
        setPage(pageNum);
        if (append) {
          setResults(prev => [...prev, ...res.data]);
        } else {
          setResults(res.data);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoading(false);
      }
    },
    [query, instrument, difficulty, emhxOnly, advancedMode,
     advName, advArtist, advAlbum, advGenre, advYear, advCharter,
     minLength, maxLength, minIntensity, maxIntensity,
     minAverageNPS, maxAverageNPS, minMaxNPS, maxMaxNPS,
     minYearNum, maxYearNum, modifiedAfter,
     hasForcedNotes, hasOpenNotes, hasTapNotes, hasSoloSections,
     hasLyrics, hasVocals, hasRollLanes, has2xKick,
     hasIssues, hasVideoBackground, modchart],
  );

  // Search once prefs are loaded
  useEffect(() => {
    if (prefsLoaded) doSearch();
  }, [prefsLoaded]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(1);
  };

  const handleLoadMore = useCallback(() => {
    doSearch(page + 1, true);
  }, [doSearch, page]);

  const handleResetAdvanced = () => {
    setAdvName(emptyText()); setAdvArtist(emptyText()); setAdvAlbum(emptyText());
    setAdvGenre(emptyText()); setAdvYear(emptyText()); setAdvCharter(emptyText());
    setMinLength(''); setMaxLength(''); setMinIntensity(''); setMaxIntensity('');
    setMinAverageNPS(''); setMaxAverageNPS(''); setMinMaxNPS(''); setMaxMaxNPS('');
    setMinYearNum(''); setMaxYearNum(''); setModifiedAfter('');
    setHasForcedNotes(null); setHasOpenNotes(null); setHasTapNotes(null);
    setHasSoloSections(null); setHasLyrics(null); setHasVocals(null);
    setHasRollLanes(null); setHas2xKick(null); setHasIssues(null);
    setHasVideoBackground(null); setModchart(null);
  };

  const handleDownload = async (chart: ChartResult) => {
    setDownloading(prev => new Set(prev).add(chart.md5));
    try {
      await startDownload(chart);
      onDownloadQueued?.(chart);
      toast(`⬇️ Queued "${chart.name}"`, 'success');
    } catch {
      toast(`Failed to queue "${chart.name}"`, 'error');
      setDownloading(prev => { const next = new Set(prev); next.delete(chart.md5); return next; });
    }
  };

  const hasMore = response ? results.length < response.found : false;

  // Infinite scroll: observe the sentinel element at the bottom of results
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loading) {
          handleLoadMore();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, handleLoadMore]);

  return (
    <div className="space-y-4">
      {!advancedMode ? (
        <>
          {/* ── Simple search bar ─────────────────────────── */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              ref={searchRef}
              type="search"
              placeholder="Search songs or artists..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                         placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500
                         transition"
            />
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white
                         font-semibold rounded-lg px-3 sm:px-4 py-2 text-sm transition"
              aria-label="Search"
            >
              <span className="hidden sm:inline">{loading ? '...' : 'Search'}</span>
              <span className="sm:hidden">
                {loading ? <SpinIcon /> : <SearchIcon />}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setAdvancedMode(true)}
              className="shrink-0 rounded-lg px-2 py-2 text-sm border transition
                         bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
              title="Advanced Search"
            >
              <FilterIcon />
            </button>
          </form>
        </>
      ) : (
        <>
          {/* ── Advanced Search Panel ────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4 relative">
            {/* Close / back to simple */}
            <button
              onClick={() => setAdvancedMode(false)}
              className="absolute top-3 right-3 rounded-md p-1 text-gray-500 hover:text-white
                         hover:bg-gray-800 transition"
              title="Back to simple search"
            >
              <CloseIcon />
            </button>

            <h2 className="text-sm font-semibold text-gray-300 pr-8">Advanced Search</h2>

            {/* Instrument / Difficulty / EMHX */}
            <div className="flex flex-wrap gap-3 items-end">
              <Select
                label="Instrument"
                value={instrument ?? ''}
                onChange={v => setInstrument(v ? v as Instrument : null)}
                options={[
                  { value: '', label: 'Any' },
                  ...INSTRUMENTS.map(i => ({ value: i, label: instrumentLabel(i) })),
                ]}
              />
              <Select
                label="Difficulty"
                value={difficulty ?? ''}
                onChange={v => setDifficulty(v ? v as Difficulty : null)}
                disabled={emhxOnly}
                options={[
                  { value: '', label: 'Any' },
                  ...DIFFICULTIES.map(d => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })),
                ]}
              />
              <label className="flex items-center gap-2 cursor-pointer select-none pb-1.5">
                <input
                  type="checkbox"
                  checked={emhxOnly}
                  onChange={e => {
                    setEmhxOnly(e.target.checked);
                    if (e.target.checked) setDifficulty(null);
                  }}
                  className="w-4 h-4 accent-green-500"
                />
                <span className="text-sm text-gray-300">Full EMHX</span>
              </label>
            </div>

            {/* Text filter fields */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Text Filters</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <TextFilterRow label="Name" value={advName} onChange={setAdvName} />
                <TextFilterRow label="Artist" value={advArtist} onChange={setAdvArtist} />
                <TextFilterRow label="Album" value={advAlbum} onChange={setAdvAlbum} />
                <TextFilterRow label="Genre" value={advGenre} onChange={setAdvGenre} />
                <TextFilterRow label="Year" value={advYear} onChange={setAdvYear} />
                <TextFilterRow label="Charter" value={advCharter} onChange={setAdvCharter} />
              </div>
            </div>

            {/* Numeric ranges */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Ranges</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <RangeRow label="Length" min={minLength} max={maxLength} onMinChange={setMinLength} onMaxChange={setMaxLength} />
                <RangeRow label="Intensity" min={minIntensity} max={maxIntensity} onMinChange={setMinIntensity} onMaxChange={setMaxIntensity} />
                <RangeRow label="Avg NPS" min={minAverageNPS} max={maxAverageNPS} onMinChange={setMinAverageNPS} onMaxChange={setMaxAverageNPS} />
                <RangeRow label="Max NPS" min={minMaxNPS} max={maxMaxNPS} onMinChange={setMinMaxNPS} onMaxChange={setMaxMaxNPS} />
                <RangeRow label="Year" min={minYearNum} max={maxYearNum} onMinChange={setMinYearNum} onMaxChange={setMaxYearNum} />
              </div>
            </div>

            {/* Modified after */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</h3>
              <label className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-24 shrink-0">Modified After</span>
                <input
                  type="date"
                  value={modifiedAfter}
                  onChange={e => setModifiedAfter(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm text-gray-200
                             focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                {modifiedAfter && (
                  <button onClick={() => setModifiedAfter('')} className="text-gray-500 hover:text-gray-300 text-xs">clear</button>
                )}
              </label>
            </div>

            {/* Features + action buttons side-by-side on desktop */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Features</h3>
              <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                {/* Toggle grid — fills available space */}
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                  <TriToggle label="Forced Notes" value={hasForcedNotes} onChange={setHasForcedNotes} />
                  <TriToggle label="Open Notes" value={hasOpenNotes} onChange={setHasOpenNotes} />
                  <TriToggle label="Tap Notes" value={hasTapNotes} onChange={setHasTapNotes} />
                  <TriToggle label="Solo Sections" value={hasSoloSections} onChange={setHasSoloSections} />
                  <TriToggle label="Lyrics" value={hasLyrics} onChange={setHasLyrics} />
                  <TriToggle label="Vocals" value={hasVocals} onChange={setHasVocals} />
                  <TriToggle label="Roll Lanes" value={hasRollLanes} onChange={setHasRollLanes} />
                  <TriToggle label="2x Kick" value={has2xKick} onChange={setHas2xKick} />
                  <TriToggle label="Chart Issues" value={hasIssues} onChange={setHasIssues} />
                  <TriToggle label="Video BG" value={hasVideoBackground} onChange={setHasVideoBackground} />
                  <TriToggle label="Modchart" value={modchart} onChange={setModchart} />
                </div>
                {/* Action buttons — stacked on the right on desktop */}
                <div className="flex flex-row lg:flex-col gap-2 lg:w-24 shrink-0">
                  <button
                    onClick={() => doSearch(1)}
                    disabled={loading}
                    className="flex-1 lg:flex-none bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white
                               font-semibold rounded-lg px-4 py-2 text-sm transition"
                  >
                    {loading ? '...' : 'Search'}
                  </button>
                  <button
                    onClick={handleResetAdvanced}
                    className="flex-1 lg:flex-none bg-gray-800 hover:bg-gray-700 text-gray-300
                               rounded-lg px-4 py-2 text-sm transition"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Status line ─────────────────────────────────── */}
      {response && (
        <p className="text-xs text-gray-500">
          {response.found.toLocaleString()} results
          {response.search_time_ms ? ` (${response.search_time_ms}ms)` : ''}
        </p>
      )}

      {/* ── Error ───────────────────────────────────────── */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* ── Results ─────────────────────────────────────── */}
      <div className="space-y-2">
        {results.map(chart => {
          const isDownloaded = downloadedMd5s.has(chart.md5);
          const isDownloading = downloading.has(chart.md5) || inProgressMd5s.has(chart.md5);
          const hasSimilarVersion = !isDownloaded && !isDownloading &&
            downloadedNameKeys.has(`${normTitle(chart.name)}||${normTitle(chart.artist)}`);
          return (
            <ChartCard
              key={chart.chartId}
              chart={chart}
              onDownload={() => handleDownload(chart)}
              isDownloading={isDownloading}
              isDownloaded={isDownloaded}
              hasSimilarVersion={hasSimilarVersion}
            />
          );
        })}
      </div>

      {/* ── Infinite scroll sentinel ───────────────────── */}
      <div ref={sentinelRef} className="h-1" />
      {hasMore && loading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full" />
        </div>
      )}

      {!loading && results.length === 0 && prefsLoaded && (
        <p className="text-center text-gray-500 text-sm py-8">
          No results found. Try a different search term.
        </p>
      )}
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-gray-400">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm
                   text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
    </svg>
  );
}

function SpinIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function instrumentLabel(inst: string): string {
  const map: Record<string, string> = {
    guitar: 'Lead Guitar',
    guitarcoop: 'Co-op Guitar',
    rhythm: 'Rhythm Guitar',
    bass: 'Bass Guitar',
    drums: 'Drums',
    keys: 'Keys',
    guitarghl: '6-Fret Guitar',
    guitarcoopghl: '6-Fret Co-op',
    rhythmghl: '6-Fret Rhythm',
    bassghl: '6-Fret Bass',
  };
  return map[inst] ?? inst;
}

// ── Advanced search helper components ─────────────────────────────

function TextFilterRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TextFilter;
  onChange: (v: TextFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-16 shrink-0">{label}</span>
      <input
        type="text"
        value={value.value}
        onChange={e => onChange({ ...value, value: e.target.value })}
        placeholder={label}
        className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm
                   text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      <label className="flex items-center gap-1 cursor-pointer select-none" title="Exact match">
        <input
          type="checkbox"
          checked={value.exact}
          onChange={e => onChange({ ...value, exact: e.target.checked })}
          className="w-3.5 h-3.5 accent-purple-500"
        />
        <span className="text-[11px] text-gray-500">Exact</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer select-none" title="Exclude matches">
        <input
          type="checkbox"
          checked={value.exclude}
          onChange={e => onChange({ ...value, exclude: e.target.checked })}
          className="w-3.5 h-3.5 accent-red-500"
        />
        <span className="text-[11px] text-gray-500">Exclude</span>
      </label>
    </div>
  );
}

function RangeRow({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  label: string;
  min: string;
  max: string;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-20 shrink-0">{label}</span>
      <input
        type="number"
        value={min}
        onChange={e => onMinChange(e.target.value)}
        placeholder="Min"
        className="w-20 bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm
                   text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500
                   [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-gray-600 text-xs">–</span>
      <input
        type="number"
        value={max}
        onChange={e => onMaxChange(e.target.value)}
        placeholder="Max"
        className="w-20 bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm
                   text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500
                   [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}

/** Three-state toggle: null (any) → true (yes) → false (no) → null ... */
function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const cycle = () => {
    if (value === null) onChange(true);
    else if (value === true) onChange(false);
    else onChange(null);
  };

  const bg =
    value === true
      ? 'bg-green-600/20 border-green-600 text-green-400'
      : value === false
        ? 'bg-red-600/20 border-red-600 text-red-400'
        : 'bg-gray-800 border-gray-700 text-gray-500';

  const icon = value === true ? '✓' : value === false ? '✕' : '–';

  return (
    <button
      onClick={cycle}
      className={`flex items-center gap-1.5 border rounded-md px-2 py-0.5 text-xs transition select-none ${bg}`}
      title={value === null ? 'Any' : value ? 'Required' : 'Excluded'}
    >
      <span className="font-bold text-[10px] w-3 text-center">{icon}</span>
      {label}
    </button>
  );
}
