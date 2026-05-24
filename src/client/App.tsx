import { useState, useEffect } from 'react';
import { SearchPanel } from './components/SearchPanel';
import { DownloadQueue } from './components/DownloadQueue';
import { SettingsPanel } from './components/SettingsPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { LoginGate } from './components/LoginGate';
import { getMe, getConfig, subscribeDownloads, setAuthMode, setIsGuestSession } from './api';
import type { UserInfo, DownloadProgress, GuestPermissions, ChartResult } from '../shared/types';

type Tab = 'search' | 'downloads' | 'library' | 'settings';

export function App() {
  // ── State (ALL hooks must be here, before any early return) ──────
  const [user, setUser]               = useState<UserInfo | null>(null);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [guestExpired, setGuestExpired] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<Tab>('search');
  const [downloads, setDownloads]     = useState<Map<string, DownloadProgress>>(new Map());
  const [scrolled, setScrolled]       = useState(false);
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(new Set<Tab>());

  // ── Derive tab visibility now so effectiveTab is available for the effect below ──
  const isGuest = user?.isGuest === true;
  const guestPerms: GuestPermissions | undefined = isGuest ? user?.permissions : undefined;
  const showSearch    = !isGuest || (guestPerms?.canBrowseSources ?? false);
  const showDownloads = !isGuest || (guestPerms?.canViewDownloads ?? false) || (guestPerms?.canDownload ?? false);
  const showLibrary   = !isGuest || (guestPerms?.canBrowseLibrary ?? false);
  const showSettings  = !isGuest;

  const effectiveTab: Tab = (() => {
    if (tab === 'search'    && !showSearch)    return showDownloads ? 'downloads' : showLibrary ? 'library' : 'settings';
    if (tab === 'downloads' && !showDownloads) return showSearch ? 'search' : showLibrary ? 'library' : 'settings';
    if (tab === 'library'   && !showLibrary)   return showSearch ? 'search' : showDownloads ? 'downloads' : 'settings';
    if (tab === 'settings'  && !showSettings)  return showSearch ? 'search' : showDownloads ? 'downloads' : 'library';
    return tab;
  })();

  // ── Effects ──────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getMe(), getConfig()])
      .then(([u, c]) => {
        setAuthMode(c.authMode);
        setIsGuestSession(u.isGuest === true);
        if (!u.isGuest) document.cookie = 'guestHint=; Max-Age=0; path=/';
        setUser(u);
        setAuthEnabled(c.authEnabled);
        setLoading(false);
      })
      .catch(() => {
        const wasGuest = document.cookie.split(';').some(c => c.trim().startsWith('guestHint='));
        setGuestExpired(wasGuest);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const unsub = subscribeDownloads(dp => {
      setDownloads(prev => {
        const next = new Map(prev);
        const existing = prev.get(dp.md5);
        if (existing?.chart && !dp.chart) dp.chart = existing.chart;
        next.set(dp.md5, dp);
        return next;
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    // Hysteresis prevents rapid toggling near the boundary when the header
    // height change slightly shifts the scroll position.
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(prev => y > 20 ? true : y < 5 ? false : prev);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lazy-mount: once a tab is visited, keep it in the DOM (hidden with display:none) rather
  // than unmounting - preserves search results and scroll position when switching tabs.
  useEffect(() => {
    setMountedTabs(prev => prev.has(effectiveTab) ? prev : new Set([...prev, effectiveTab]));
  }, [effectiveTab]);

  // ── Handlers ─────────────────────────────────────────────────────
  const handleRemove = (md5: string) => {
    setDownloads(prev => { const next = new Map(prev); next.delete(md5); return next; });
  };

  const handleRescan = (updated: DownloadProgress[]) => {
    // Replace the entire map with the server's authoritative snapshot so
    // deleted songs disappear and duplicates are cleaned up.
    setDownloads(new Map(updated.map(dp => [dp.md5, dp])));
  };

  // Optimistic update: add queued item immediately when POST returns so the
  // Downloads tab shows it without waiting for the SSE event to flush.
  const handleDownloadQueued = (chart: ChartResult) => {
    setDownloads(prev => {
      const existing = prev.get(chart.md5);
      if (existing && existing.status !== 'error') return prev;
      const dp: DownloadProgress = {
        md5: chart.md5,
        name: chart.name ?? 'Unknown',
        artist: chart.artist ?? 'Unknown',
        charter: chart.charter ?? 'Unknown',
        status: 'queued',
        percent: null,
        albumArtMd5: chart.albumArtMd5 ?? null,
        chart,
      };
      const next = new Map(prev);
      next.set(dp.md5, dp);
      return next;
    });
  };

  // ── Early returns (after ALL hooks) ──────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (authEnabled && !user) {
    return <LoginGate guestExpired={guestExpired} />;
  }

  // A tab renders if it's the active tab OR has been visited before
  const shouldRender = (t: Tab) => t === effectiveTab || mountedTabs.has(t);

  return (
    <div className="flex flex-col min-h-dvh">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between py-2">
          {/* Left: icon + title - hidden on mobile to prevent side-scroll */}
          <div className="hidden sm:flex items-center gap-2">
            <img
              src="/guitar_cape_icon_128x128.png"
              alt=""
              className={`transition-all duration-300 ${scrolled ? 'w-8 h-8' : 'w-14 h-14'}`}
            />
            <span className="text-lg font-bold tracking-tight hidden sm:inline">Clone Sidekick</span>
          </div>

          {/* Center: tab bar */}
          <nav className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
            {showSearch && (
              <TabButton active={effectiveTab === 'search'} onClick={() => setTab('search')}>
                Search
              </TabButton>
            )}
            {showDownloads && (
              <TabButton active={effectiveTab === 'downloads'} onClick={() => setTab('downloads')}>
                Downloads
              </TabButton>
            )}
            {showLibrary && (
              <TabButton active={effectiveTab === 'library'} onClick={() => setTab('library')}>
                Library
              </TabButton>
            )}
            {showSettings && (
              <TabButton active={effectiveTab === 'settings'} onClick={() => setTab('settings')}>
                Settings
              </TabButton>
            )}
          </nav>

          {/* Right: user avatar / guest badge / logout */}
          {isGuest ? (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 text-xs font-medium border border-purple-800">
                Guest
              </span>
            </div>
          ) : user && user.email !== 'local' ? (
            <a
              href="/auth/logout"
              title={`Logged in as ${user.displayName}`}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition"
            >
              {user.photo && <img src={user.photo} alt="" className="w-7 h-7 rounded-full" />}
              <span className="hidden sm:inline">{user.displayName}</span>
            </a>
          ) : (
            <div className="w-0 sm:w-24" />
          )}
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────── */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-4">
        {showSearch && shouldRender('search') && (
          <div style={{ display: effectiveTab === 'search' ? undefined : 'none' }}>
            <SearchPanel downloads={downloads} onDownloadQueued={handleDownloadQueued} />
          </div>
        )}
        {showDownloads && shouldRender('downloads') && (
          <div style={{ display: effectiveTab === 'downloads' ? undefined : 'none' }}>
            <DownloadQueue downloads={downloads} onRemove={handleRemove} />
          </div>
        )}
        {showLibrary && shouldRender('library') && (
          <div style={{ display: effectiveTab === 'library' ? undefined : 'none' }}>
            <LibraryPanel downloads={downloads} onRescan={handleRescan} onRemove={handleRemove} isAdmin={!isGuest} />
          </div>
        )}
        {showSettings && shouldRender('settings') && (
          <div style={{ display: effectiveTab === 'settings' ? undefined : 'none' }}>
            <SettingsPanel />
          </div>
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-sm font-medium transition ${
        active ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
