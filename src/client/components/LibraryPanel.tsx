import { useState, useMemo, useEffect, useRef } from 'react';
import { rescanLibrary, deleteDownload } from '../api';
import { DownloadItem } from './DownloadQueue';
import { INST_DEFS } from './InstrumentBadges';
import type { DownloadProgress } from '../../shared/types';

type SortKey = 'name' | 'artist' | 'charter' | 'newest' | 'oldest';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'artist',  label: 'Artist A–Z' },
  { value: 'name',    label: 'Song A–Z' },
  { value: 'charter', label: 'Charter A–Z' },
  { value: 'newest',  label: 'Newest first' },
  { value: 'oldest',  label: 'Oldest first' },
];

function sortEntries(items: DownloadProgress[], key: SortKey): DownloadProgress[] {
  return [...items].sort((a, b) => {
    switch (key) {
      case 'name':    return (a.name ?? '').localeCompare(b.name ?? '');
      case 'artist':  return (a.artist ?? '').localeCompare(b.artist ?? '');
      case 'charter': return (a.charter ?? '').localeCompare(b.charter ?? '');
      case 'newest':  return (b.downloadedAt ?? '').localeCompare(a.downloadedAt ?? '');
      case 'oldest':  return (a.downloadedAt ?? '').localeCompare(b.downloadedAt ?? '');
    }
  });
}

export function LibraryPanel({
  downloads,
  onRescan,
  onRemove,
  isAdmin = false,
}: {
  downloads: Map<string, DownloadProgress>;
  onRescan: (updated: DownloadProgress[]) => void;
  onRemove?: (md5: string) => void;
  isAdmin?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('artist');
  const [scanning, setScanning] = useState(false);
  const [randomPick, setRandomPick] = useState<DownloadProgress | null>(null);
  const [filterGenre, setFilterGenre] = useState('');
  const [filterInstruments, setFilterInstruments] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const onRescanRef = useRef(onRescan);
  onRescanRef.current = onRescan;

  // Auto-scan the songs directory the first time the Library tab is opened
  useEffect(() => {
    let cancelled = false;
    setScanning(true);
    rescanLibrary()
      .then(updated => { if (!cancelled) onRescanRef.current(updated); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setScanning(false); });
    return () => { cancelled = true; };
  }, []);

  const installed = useMemo(
    () => [...downloads.values()].filter(d => d.status === 'done'),
    [downloads],
  );

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const d of installed) {
      const g = d.chart?.genre;
      if (g) set.add(g);
    }
    return [...set].sort();
  }, [installed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let matches = q
      ? installed.filter(d =>
          d.name.toLowerCase().includes(q) ||
          d.artist.toLowerCase().includes(q) ||
          (d.charter ?? '').toLowerCase().includes(q),
        )
      : installed;

    if (filterGenre) {
      matches = matches.filter(d => d.chart?.genre === filterGenre);
    }

    if (filterInstruments.size > 0) {
      matches = matches.filter(d =>
        d.chart && [...filterInstruments].every(key => {
          const def = INST_DEFS.find(def => def.key === key);
          if (!def) return false;
          const val = (d.chart as any)[def.diffKey];
          return val != null && val >= 0;
        }),
      );
    }

    return sortEntries(matches, sortKey);
  }, [installed, query, sortKey, filterGenre, filterInstruments]);

  // Clear random pick if it's no longer in the filtered list
  useEffect(() => {
    if (randomPick && !filtered.find(d => d.md5 === randomPick.md5)) {
      setRandomPick(null);
    }
  }, [filtered, randomPick]);

  async function handleRescan() {
    setScanning(true);
    try {
      const updated = await rescanLibrary();
      onRescan(updated);
    } catch { /* ignore */ }
    setScanning(false);
  }

  function pickRandom() {
    if (filtered.length === 0) return;
    setRandomPick(filtered[Math.floor(Math.random() * filtered.length)]);
  }

  const hasFilters = !!filterGenre || filterInstruments.size > 0;

  const toggleInstrument = (key: string) => {
    setFilterInstruments(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSelect = (md5: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(md5)) next.delete(md5); else next.add(md5);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    for (const md5 of selected) {
      try { await deleteDownload(md5); onRemove?.(md5); } catch { /* ignore */ }
    }
    setBulkDeleting(false);
    setSelected(new Set());
    setShowBulkConfirm(false);
    setSelectMode(false);
    // Rescan so the library list reflects the deletions
    try { const updated = await rescanLibrary(); onRescanRef.current(updated); } catch { /* ignore */ }
  };

  const allSelected = filtered.length > 0 && filtered.every(d => selected.has(d.md5));

  return (
    <div className="space-y-4">
      {/* ── Header bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by song, artist or charter…"
          className="flex-1 min-w-[180px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
        />
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {!selectMode && (
          <button
            onClick={pickRandom}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-sm text-white rounded-lg transition"
          >
            🎲 Random
          </button>
        )}
        {!selectMode && (
          <button
            onClick={handleRescan}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm text-white rounded-lg transition"
          >
            {scanning ? '…' : '↺ Rescan'}
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => { setSelectMode(m => !m); setSelected(new Set()); }}
            className={`px-3 py-2 rounded-lg text-sm transition ${
              selectMode
                ? 'bg-purple-700 text-white hover:bg-purple-600'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          {filtered.length.toLocaleString()} of {installed.length.toLocaleString()} songs
        </span>
      </div>

      {/* ── Bulk select action bar ─────────────────────────────── */}
      {selectMode && (
        <div className="flex items-center gap-3 py-2 px-3 bg-gray-800 rounded-xl border border-gray-700">
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                if (allSelected) setSelected(new Set());
                else setSelected(new Set(filtered.map(d => d.md5)));
              }}
              className="accent-purple-500"
            />
            Select all
          </label>
          <span className="text-xs text-gray-500">{selected.size} selected</span>
          <button
            onClick={() => selected.size > 0 && setShowBulkConfirm(true)}
            disabled={selected.size === 0}
            className="ml-auto text-xs px-3 py-1 rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white transition"
          >
            Delete {selected.size > 0 ? selected.size : ''} selected
          </button>
        </div>
      )}

      {/* ── Filter row ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Genre dropdown */}
        <select
          value={filterGenre}
          onChange={e => setFilterGenre(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500"
        >
          <option value="">All genres</option>
          {genres.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        {/* Instrument toggle buttons */}
        {INST_DEFS.map(def => (
          <button
            key={def.key}
            onClick={() => toggleInstrument(def.key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
              filterInstruments.has(def.key)
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {def.label}
          </button>
        ))}

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={() => { setFilterGenre(''); setFilterInstruments(new Set()); }}
            className="px-2.5 py-1 rounded-md text-xs text-gray-500 hover:text-white transition"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Song list ───────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-500 py-16 text-sm">
          {installed.length === 0
            ? 'No songs in library yet. Download some charts or click Rescan.'
            : 'No songs match your search.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(dp => (
            <DownloadItem
              key={dp.md5}
              item={dp}
              readOnly
              selectMode={selectMode}
              isSelected={selected.has(dp.md5)}
              onToggleSelect={() => toggleSelect(dp.md5)}
            />
          ))}
        </div>
      )}

      {/* ── Bulk delete confirmation modal ───────────────────────── */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-semibold text-white">Delete {selected.size} song{selected.size !== 1 ? 's' : ''}?</h3>
            <p className="text-xs text-gray-400">This will permanently delete the selected song files from disk. This cannot be undone.</p>
            <ul className="max-h-40 overflow-y-auto space-y-1">
              {[...selected].map(md5 => {
                const dp = downloads.get(md5);
                return dp ? (
                  <li key={md5} className="text-xs text-gray-300 truncate">{dp.artist} — {dp.name}</li>
                ) : null;
              })}
            </ul>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowBulkConfirm(false)}
                disabled={bulkDeleting}
                className="text-xs px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="text-xs px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white transition"
              >
                {bulkDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Random pick modal ───────────────────────────────────── */}
      {randomPick && (
        <RandomModal dp={randomPick} onClose={() => setRandomPick(null)} onAgain={pickRandom} />
      )}
    </div>
  );
}

function RandomModal({
  dp,
  onClose,
  onAgain,
}: {
  dp: DownloadProgress;
  onClose: () => void;
  onAgain: () => void;
}) {
  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <p className="text-sm text-purple-400 font-semibold tracking-wide">🎲 Random Pick</p>
          <div className="flex gap-2">
            <button
              onClick={onAgain}
              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-sm text-white rounded-lg transition"
            >
              Pick Again
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-sm text-white rounded-lg transition"
            >
              Close
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto p-2">
          <DownloadItem item={dp} readOnly defaultExpanded />
        </div>
      </div>
    </div>
  );
}
