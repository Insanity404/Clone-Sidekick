import { useState, useEffect } from 'react';
import { SearchPanel } from './components/SearchPanel';
import { DownloadQueue } from './components/DownloadQueue';
import { SettingsPanel } from './components/SettingsPanel';
import { LoginGate } from './components/LoginGate';
import { getMe, getConfig, subscribeDownloads, setAuthMode, setIsGuestSession } from './api';
import type { UserInfo, DownloadProgress, GuestPermissions } from '../shared/types';

type Tab = 'search' | 'downloads' | 'settings';

export function App() {
  const [user, setUser]               = useState<UserInfo | null>(null);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [guestExpired, setGuestExpired] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<Tab>('search');
  const [downloads, setDownloads]     = useState<Map<string, DownloadProgress>>(new Map());
  const [scrolled, setScrolled]       = useState(false);

  useEffect(() => {
    Promise.all([getMe(), getConfig()])
      .then(([u, c]) => {
        setAuthMode(c.authMode);
        setIsGuestSession(u.isGuest === true);
        // Clear the hint cookie when an admin logs in successfully
        if (!u.isGuest) document.cookie = 'guestHint=; Max-Age=0; path=/';
        setUser(u);
        setAuthEnabled(c.authEnabled);
        setLoading(false);
      })
      .catch(() => {
        // If a non-httpOnly guestHint cookie exists, this was an expired guest session
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
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleRemove = (md5: string) => {
    setDownloads(prev => { const next = new Map(prev); next.delete(md5); return next; });
  };

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

  const isGuest = user?.isGuest === true;
  const guestPerms: GuestPermissions | undefined = isGuest ? user?.permissions : undefined;

  // Tabs available to this session
  const showSearch    = !isGuest || (guestPerms?.canBrowseSources ?? false);
  const showDownloads = !isGuest || (guestPerms?.canBrowseLibrary ?? false) || (guestPerms?.canDownload ?? false);
  const showSettings  = !isGuest;

  // If the current tab became hidden, move to the first visible one
  const effectiveTab: Tab =
    (tab === 'search' && !showSearch) ||
    (tab === 'downloads' && !showDownloads) ||
    (tab === 'settings' && !showSettings)
      ? showSearch ? 'search' : showDownloads ? 'downloads' : 'settings'
      : tab;

  const downloadedMd5s = new Set(
    [...downloads.values()].filter(d => d.status === 'done').map(d => d.md5),
  );

  return (
    <div className="flex flex-col min-h-dvh">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between py-2">
          {/* Left: icon + title */}
          <div className="flex items-center gap-2">
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
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-4">
        {effectiveTab === 'search' && showSearch && (
          <SearchPanel downloadedMd5s={downloadedMd5s} />
        )}
        {effectiveTab === 'downloads' && showDownloads && (
          <DownloadQueue downloads={downloads} onRemove={handleRemove} />
        )}
        {effectiveTab === 'settings' && showSettings && (
          <SettingsPanel />
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
