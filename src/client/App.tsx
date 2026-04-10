import { useState, useEffect } from 'react';
import { SearchPanel } from './components/SearchPanel';
import { DownloadQueue } from './components/DownloadQueue';
import { SettingsPanel } from './components/SettingsPanel';
import { LoginGate } from './components/LoginGate';
import { getMe, getConfig, subscribeDownloads, setAuthMode } from './api';
import type { UserInfo, DownloadProgress } from '../shared/types';

export function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'search' | 'downloads' | 'settings'>('search');
  const [downloads, setDownloads] = useState<Map<string, DownloadProgress>>(new Map());
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    Promise.all([getMe(), getConfig()])
      .then(([u, c]) => {
        setAuthMode(c.authMode);
        setUser(u);
        setAuthEnabled(c.authEnabled);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Single SSE subscription owned at app level so both tabs share state
  useEffect(() => {
    const unsub = subscribeDownloads(dp => {
      setDownloads(prev => {
        const next = new Map(prev);
        const existing = prev.get(dp.md5);
        // Merge: preserve chart data from prior events when not present on progress updates
        if (existing?.chart && !dp.chart) {
          dp.chart = existing.chart;
        }
        next.set(dp.md5, dp);
        return next;
      });
    });
    return unsub;
  }, []);

  // Track scroll position for collapsible header
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
    return <LoginGate />;
  }

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
            <TabButton active={tab === 'search'} onClick={() => setTab('search')}>
              Search
            </TabButton>
            <TabButton active={tab === 'downloads'} onClick={() => setTab('downloads')}>
              Downloads
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              Settings
            </TabButton>
          </nav>

          {/* Right: user avatar / logout */}
          {user && user.email !== 'local' ? (
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
        {tab === 'search' && <SearchPanel downloadedMd5s={downloadedMd5s} />}
        {tab === 'downloads' && <DownloadQueue downloads={downloads} onRemove={handleRemove} />}
        {tab === 'settings' && <SettingsPanel />}
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
