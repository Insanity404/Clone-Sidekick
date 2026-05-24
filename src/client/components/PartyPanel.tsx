import { useState, useEffect, useCallback } from 'react';
import {
  getParty,
  updatePartyConfig,
  createGuestSession,
  getSessionQR,
  revokeGuestSession,
  revokeAllGuestSessions,
} from '../api';
import { useToast } from './Toast';
import type { PartyConfig, GuestSession, GuestDeleteMode } from '../../shared/types';

export function PartyPanel() {
  const [partyConfig, setPartyConfig] = useState<PartyConfig | null>(null);
  const [sessions, setSessions]       = useState<GuestSession[]>([]);
  const [loading, setLoading]         = useState(true);
  const [qrModal, setQrModal]         = useState<{ dataUrl: string; joinUrl: string } | null>(null);
  const [creating, setCreating]       = useState(false);
  const { toast } = useToast();

  const reload = useCallback(async () => {
    try {
      const { config, sessions } = await getParty();
      setPartyConfig(config);
      setSessions(sessions);
    } catch {
      toast('Failed to load party settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  // ── Config helpers ──────────────────────────────────────────────

  async function patchConfig(partial: Partial<PartyConfig>) {
    if (!partyConfig) return;
    const next = { ...partyConfig, ...partial };
    setPartyConfig(next);
    try {
      const { config: saved } = await updatePartyConfig(next);
      setPartyConfig(saved);
      if (!saved.enabled) setSessions([]);
      toast('Party settings saved', 'success');
    } catch {
      toast('Failed to save party settings', 'error');
      setPartyConfig(partyConfig); // revert
    }
  }

  function patchPermissions(partial: Partial<PartyConfig['defaultPermissions']>) {
    if (!partyConfig) return;
    patchConfig({ defaultPermissions: { ...partyConfig.defaultPermissions, ...partial } });
  }

  // ── Session helpers ─────────────────────────────────────────────

  async function handleCreateSession() {
    setCreating(true);
    try {
      const { session, joinUrl } = await createGuestSession();
      setSessions(prev => [...prev, session]);
      const qr = await getSessionQR(session.token);
      setQrModal(qr);
    } catch (err: any) {
      toast(err?.message ?? 'Failed to create guest link', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleShowQR(token: string) {
    try {
      const qr = await getSessionQR(token);
      setQrModal(qr);
    } catch {
      toast('Failed to load QR code', 'error');
    }
  }

  async function handleRevoke(token: string) {
    await revokeGuestSession(token);
    setSessions(prev => prev.filter(s => s.token !== token));
    toast('Guest link revoked', 'success');
  }

  async function handleRevokeAll() {
    await revokeAllGuestSessions();
    setSessions([]);
    toast('All guest links revoked', 'success');
  }

  // ── Render ──────────────────────────────────────────────────────

  if (loading || !partyConfig) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const { defaultPermissions: perms } = partyConfig;

  return (
    <div className="space-y-5">

      {/* Enable / disable */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Party Mode</p>
          <p className="text-xs text-gray-500">Let guests join with a temporary QR link</p>
        </div>
        <Toggle checked={partyConfig.enabled} onChange={v => patchConfig({ enabled: v })} />
      </div>

      {partyConfig.enabled && (
        <>
          {/* Session duration */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Guest link duration
            </label>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 4, 8, 12, 24].map(h => (
                <button
                  key={h}
                  onClick={() => patchConfig({ sessionDurationHours: h })}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                    partyConfig.sessionDurationHours === h
                      ? 'border-purple-500 bg-purple-900/30 text-white'
                      : 'border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>

          {/* Default permissions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Default guest permissions
            </p>
            <div className="bg-gray-800 rounded-xl p-3 space-y-2.5">
              <PermToggle
                label="Browse Search)"
                checked={perms.canBrowseSources}
                onChange={v => patchPermissions({ canBrowseSources: v })}
              />
              <PermToggle
                label="Browse Library)"
                checked={perms.canBrowseLibrary}
                onChange={v => patchPermissions({ canBrowseLibrary: v })}
              />
              <PermToggle
                label="Browse Downloads"
                checked={perms.canViewDownloads}
                onChange={v => patchPermissions({ canViewDownloads: v })}
              />
              <PermToggle
                label="Download Songs"
                checked={perms.canDownload}
                onChange={v => patchPermissions({ canDownload: v })}
              />
              <div className="space-y-1 pt-1 border-t border-gray-700">
                <p className="text-xs text-gray-400 font-medium">Delete permission</p>
                <div className="flex gap-2">
                  {(['none', 'own', 'any'] as GuestDeleteMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => patchPermissions({ deleteMode: mode })}
                      className={`px-3 py-1 rounded-lg text-xs border transition ${
                        perms.deleteMode === mode
                          ? 'border-purple-500 bg-purple-900/30 text-white'
                          : 'border-gray-700 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {mode === 'none' ? 'None' : mode === 'own' ? 'Own songs' : 'Any song'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Active sessions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Active guest links
                {sessions.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-purple-900/40 text-purple-300 rounded text-xs">
                    {sessions.length}
                  </span>
                )}
              </p>
              {sessions.length > 0 && (
                <button
                  onClick={handleRevokeAll}
                  className="text-xs text-red-400 hover:text-red-300 transition"
                >
                  Revoke all
                </button>
              )}
            </div>

            {sessions.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No active links</p>
            ) : (
              <div className="space-y-1.5">
                {sessions.map(s => (
                  <SessionRow
                    key={s.token}
                    session={s}
                    onShowQR={() => handleShowQR(s.token)}
                    onRevoke={() => handleRevoke(s.token)}
                  />
                ))}
              </div>
            )}

            <button
              onClick={handleCreateSession}
              disabled={creating}
              className="w-full py-2 rounded-xl border-2 border-dashed border-gray-700 hover:border-purple-500 text-sm text-gray-400 hover:text-white transition disabled:opacity-50"
            >
              {creating ? 'Creating…' : '+ Create guest link'}
            </button>
          </div>
        </>
      )}

      {/* QR modal */}
      {qrModal && (
        <QRModal
          dataUrl={qrModal.dataUrl}
          joinUrl={qrModal.joinUrl}
          onClose={() => setQrModal(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-purple-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function PermToggle({
  label,
  checked,
  onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-sm text-gray-300">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </label>
  );
}

function SessionRow({
  session,
  onShowQR,
  onRevoke,
}: { session: GuestSession; onShowQR: () => void; onRevoke: () => void }) {
  const expiresAt = new Date(session.expiresAt);
  const now = new Date();
  const msLeft = expiresAt.getTime() - now.getTime();
  const hoursLeft = Math.ceil(msLeft / 3_600_000);
  const label = hoursLeft <= 1 ? '< 1h left' : `${hoursLeft}h left`;

  return (
    <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 gap-2">
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-mono truncate">{session.token.slice(0, 12)}…</p>
        <p className="text-xs text-gray-600">{label}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onShowQR}
          className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
        >
          QR
        </button>
        <button
          onClick={onRevoke}
          className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-red-900/50 text-gray-300 hover:text-red-300 transition"
        >
          Revoke
        </button>
      </div>
    </div>
  );
}

function QRModal({
  dataUrl,
  joinUrl,
  onClose,
}: { dataUrl: string; joinUrl: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Guest Link</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition text-xl leading-none">×</button>
        </div>

        <div className="flex justify-center">
          <img src={dataUrl} alt="QR code" className="w-48 h-48 rounded-xl bg-white p-1" />
        </div>

        <p className="text-xs text-gray-400 text-center">
          Scan to join, or share the link below
        </p>

        <div className="flex gap-2">
          <input
            readOnly
            value={joinUrl}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono focus:outline-none"
          />
          <button
            onClick={handleCopy}
            className="shrink-0 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition"
          >
            {copied ? '✓' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
