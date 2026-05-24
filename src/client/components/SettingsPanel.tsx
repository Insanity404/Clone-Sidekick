import { useState, useEffect, useRef, useCallback } from 'react';
import { getSetupStatus, getSetupDefaults, validateDir, saveSetupConfig } from '../setup/setupApi';
import { getPrefs, savePrefs } from '../api';
import { useToast } from './Toast';
import { PartyPanel } from './PartyPanel';
import type { SafeConfig } from '../setup/setupApi';
import type { DownloadFormat } from '../../shared/types';

export function SettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<SafeConfig | null>(null);
  const [suggestion, setSuggestion] = useState('');
  const [dirState, setDirState] = useState<{ ok: boolean; warning?: string; error?: string } | null>(null);
  const [dirChecking, setDirChecking] = useState(false);
  const [yargDirState, setYargDirState] = useState<{ ok: boolean; warning?: string; error?: string } | null>(null);
  const [yargDirChecking, setYargDirChecking] = useState(false);
  const [emailsRaw, setEmailsRaw] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [secretEdited, setSecretEdited] = useState(false);
  const [showTunnelToken, setShowTunnelToken] = useState(false);
  const [tunnelTokenEdited, setTunnelTokenEdited] = useState(false);
  const [dlFormat, setDlFormat] = useState<DownloadFormat>('folder');
  const [dlVideoBackground, setDlVideoBackground] = useState(false);
  const [currentPrefs, setCurrentPrefs] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([getSetupStatus(), getSetupDefaults(), getPrefs()])
      .then(([status, defaults, prefs]) => {
        setForm(status.current);
        setEmailsRaw(status.current.auth.google.allowedEmails.join('\n'));
        setSuggestion(defaults.songsDirSuggestion);
        setDlFormat(prefs.downloadFormat ?? 'folder');
        setDlVideoBackground(prefs.downloadVideoBackground ?? false);
        setCurrentPrefs(prefs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── Save helpers ─────────────────────────────────────────────
  // formRef always holds the latest form so blur handlers see current state
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);

  const save = useCallback(async (override?: SafeConfig) => {
    const data = override ?? formRef.current;
    if (!data) return;
    try {
      await saveSetupConfig(data as any);
      toast('✓ Settings saved', 'success');
    } catch {
      toast('✗ Failed to save', 'error');
    }
  }, [toast]);

  // For toggles/selects: update state and save the new value immediately
  function patchAndSave(partial: Partial<SafeConfig>) {
    const updated = form ? { ...form, ...partial } : null;
    setForm(updated);
    if (updated) save(updated);
  }

  // blur handler for text inputs — saves the latest form state
  const onBlurSave = useCallback(() => { save(); }, [save]);

  if (loading || !form) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  function patch(partial: Partial<SafeConfig>) {
    setForm(prev => prev ? { ...prev, ...partial } : prev);
  }

  function patchGoogle(partial: Partial<SafeConfig['auth']['google']>) {
    if (!form) return;
    patch({ auth: { ...form.auth, google: { ...form.auth.google, ...partial } } });
  }

  async function handleVerifyDir() {
    if (!form?.cloneHeroSongsDir) return;
    setDirChecking(true);
    setDirState(null);
    const r = await validateDir(form.cloneHeroSongsDir);
    setDirState(r);
    setDirChecking(false);
  }

  async function handleVerifyYargDir() {
    if (!form?.yargSongsDir) return;
    setYargDirChecking(true);
    setYargDirState(null);
    const r = await validateDir(form.yargSongsDir);
    setYargDirState(r);
    setYargDirChecking(false);
  }

  function handleEmailsChange(value: string) {
    setEmailsRaw(value);
    const emails = value.split('\n').map(e => e.trim().toLowerCase()).filter(Boolean);
    patchGoogle({ allowedEmails: emails });
  }

  function handleDlFormatChange(fmt: DownloadFormat) {
    setDlFormat(fmt);
    const merged = { ...currentPrefs, downloadFormat: fmt, downloadVideoBackground: dlVideoBackground };
    setCurrentPrefs(merged);
    savePrefs(merged).catch(() => {});
  }

  function handleDlVideoChange(checked: boolean) {
    setDlVideoBackground(checked);
    const merged = { ...currentPrefs, downloadFormat: dlFormat, downloadVideoBackground: checked };
    setCurrentPrefs(merged);
    savePrefs(merged).catch(() => {});
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-8">

      {/* ── About ───────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex justify-center">
          <img src="/guitar_cape_icon_512x512.png" alt="Clone Sidekick" className="w-40 h-40 sm:w-64 sm:h-64 object-contain" />
        </div>
        <h3 className="text-sm font-semibold text-white">
          About Clone Sidekick
        </h3>
        <p className="text-sm text-gray-300 leading-relaxed">
          Clone Sidekick was created to make finding and installing custom
          charts for <a href="https://clonehero.net" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline underline-offset-2">Clone Hero</a> as
          painless as possible. Browse, preview, and download charts from{' '}
          <a
            href="https://enchor.us"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
          >
            Enchor.us
          </a>{' '}
          straight into your songs folder. No manual ZIP wrangling
          needed. From the couch to the PC!
        </p>
        <p className="text-sm text-gray-300 leading-relaxed">
          This is a free, open-source project built for the Clone Hero
          community. If you find it useful, be sure to share it with your friends.
        </p>
        <div className="pt-1">
          <a
            href="https://github.com/Insanity404/Clone-Sidekick"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 transition group"
          >
            <GitHubIcon />
            <div className="text-left">
              <div className="text-sm font-semibold text-white group-hover:text-purple-300 transition">Insanity404 / Clone-Sidekick</div>
              <div className="text-xs text-gray-400">View source, report issues, contribute</div>
            </div>
            <svg className="w-4 h-4 text-gray-500 group-hover:text-gray-300 transition ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>

      {/* ── Songs Directory ─────────────────────────────────────── */}
      <Section title="Songs Directory" desc="Where downloaded charts are extracted.">
        <div className="flex gap-2">
          <input
            type="text"
            value={form.cloneHeroSongsDir}
            onChange={e => { patch({ cloneHeroSongsDir: e.target.value }); setDirState(null); }}
            onBlur={onBlurSave}
            placeholder={suggestion}
            className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={handleVerifyDir}
            disabled={dirChecking || !form.cloneHeroSongsDir}
            className="shrink-0 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm text-white rounded-lg transition"
          >
            {dirChecking ? '…' : 'Verify'}
          </button>
        </div>
        {dirState && (
          <p className={`text-xs mt-1 ${dirState.ok ? 'text-green-400' : 'text-red-400'}`}>
            {dirState.ok ? (dirState.warning ?? '✓ Directory found') : `✗ ${dirState.error}`}
          </p>
        )}
      </Section>

      {/* ── YARG Songs Directory ────────────────────────────────── */}
      <Section title="YARG Songs Directory" desc="Optional. When set, charts are also installed here after every Clone Hero download.">
        <div className="flex gap-2">
          <input
            type="text"
            value={form.yargSongsDir}
            onChange={e => { patch({ yargSongsDir: e.target.value }); setYargDirState(null); }}
            onBlur={onBlurSave}
            placeholder="e.g. C:\Users\YourName\AppData\LocalLow\tgk\YARG\songs"
            className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={handleVerifyYargDir}
            disabled={yargDirChecking || !form.yargSongsDir}
            className="shrink-0 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm text-white rounded-lg transition"
          >
            {yargDirChecking ? '…' : 'Verify'}
          </button>
        </div>
        {yargDirState && (
          <p className={`text-xs mt-1 ${yargDirState.ok ? 'text-green-400' : 'text-red-400'}`}>
            {yargDirState.ok ? (yargDirState.warning ?? '✓ Directory found') : `✗ ${yargDirState.error}`}
          </p>
        )}
      </Section>

      {/* ── Download Format ─────────────────────────────────────── */}
      <Section title="Download Format" desc="Choose how charts are saved to your songs directory.">
        <div className="grid grid-cols-2 gap-3">
          <ModeCard
            active={dlFormat === 'sng'}
            onClick={() => handleDlFormatChange('sng')}
            icon="📄" title=".sng File" desc="Single packed file"
          />
          <ModeCard
            active={dlFormat === 'folder'}
            onClick={() => handleDlFormatChange('folder')}
            icon="📁" title="Chart Folder" desc="Extracted chart files"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={dlVideoBackground}
            onChange={e => handleDlVideoChange(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
          />
          <span className="text-sm text-gray-300">Download video backgrounds</span>
          <span className="text-xs text-gray-500">(larger file size)</span>
        </label>
      </Section>

      {/* ── Authentication ──────────────────────────────────────── */}
      <Section title="Authentication" desc="Control who can access Clone Sidekick.">
        <div className="grid grid-cols-2 gap-3">
          <ModeCard
            active={form.auth.mode === 'none'}
            onClick={() => patchAndSave({ auth: { ...form.auth, mode: 'none' } })}
            icon="🔓" title="No Auth" desc="LAN use only"
          />
          <ModeCard
            active={form.auth.mode === 'google'}
            onClick={() => patchAndSave({ auth: { ...form.auth, mode: 'google' } })}
            icon="🔐" title="Google OAuth" desc="Required for WAN"
          />
        </div>

        {form.auth.mode === 'google' && (
          <div className="space-y-3 mt-3">
            <Field label="Client ID">
              <input
                type="text"
                value={form.auth.google.clientId}
                onChange={e => patchGoogle({ clientId: e.target.value })}
                onBlur={onBlurSave}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
              />
            </Field>
            <Field label="Client Secret" hint={secretEdited ? undefined : 'Showing masked value — type to replace'}>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={form.auth.google.clientSecret}
                  onChange={e => { setSecretEdited(true); patchGoogle({ clientSecret: e.target.value }); }}
                  onBlur={onBlurSave}
                  className={`w-full bg-gray-900 border rounded-lg px-3 py-2 pr-14 text-sm text-white focus:outline-none focus:border-purple-500 ${secretEdited ? 'border-gray-700' : 'border-yellow-800/60'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
                >
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            <Field label="Callback URL">
              <input
                type="text"
                value={form.auth.google.callbackUrl}
                onChange={e => patchGoogle({ callbackUrl: e.target.value })}
                onBlur={onBlurSave}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-purple-500"
              />
            </Field>
            <Field label="Allowed Emails" hint="One per line. Leave empty to allow any Google account.">
              <textarea
                rows={4}
                value={emailsRaw}
                onChange={e => handleEmailsChange(e.target.value)}
                onBlur={onBlurSave}
                placeholder={"you@gmail.com\nfriend@gmail.com"}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-y min-h-[6rem]"
              />
            </Field>
          </div>
        )}
      </Section>

      {/* ── Remote Access ───────────────────────────────────────── */}
      <Section title="Remote Access" desc="Expose Clone Sidekick to the internet via Cloudflare Tunnel.">
        <div className="grid grid-cols-2 gap-3">
          <ModeCard
            active={!form.tunnel.enabled}
            onClick={() => patchAndSave({ tunnel: { ...form.tunnel, enabled: false } })}
            icon="🏠" title="Local Only" desc="LAN access only"
          />
          <ModeCard
            active={form.tunnel.enabled}
            onClick={() => patchAndSave({ tunnel: { ...form.tunnel, enabled: true } })}
            icon="🌐" title="Cloudflare Tunnel" desc="Secure internet access"
          />
        </div>
        {form.tunnel.enabled && (
          <div className="mt-3 space-y-3">
            <Field label="Tunnel Token" hint={
              tunnelTokenEdited
                ? 'Token will be saved encrypted.'
                : form.tunnel.token
                  ? 'Showing masked value — type to replace.'
                  : 'Paste the token from Cloudflare Zero Trust → Networks → Tunnels.'
            }>
              <div className="relative">
                <input
                  type={showTunnelToken ? 'text' : 'password'}
                  value={form.tunnel.token}
                  onChange={e => {
                    setTunnelTokenEdited(true);
                    patch({ tunnel: { ...form.tunnel, token: e.target.value } });
                  }}
                  onBlur={onBlurSave}
                  placeholder="eyJh…"
                  className={`w-full bg-gray-900 border rounded-lg px-3 py-2 pr-14 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 ${
                    !tunnelTokenEdited && form.tunnel.token ? 'border-yellow-800/60' : 'border-gray-700'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowTunnelToken(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
                >
                  {showTunnelToken ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            <Field label="Hostname" hint="The domain configured in your tunnel (used for Party Mode share links)">
              <input
                type="text"
                value={form.tunnel.hostname}
                onChange={e => patch({ tunnel: { ...form.tunnel, hostname: e.target.value } })}
                onBlur={onBlurSave}
                placeholder="guitar.example.com"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
            </Field>
          </div>
        )}
      </Section>

      {/* ── Party Mode ─────────────────────────────────────────── */}
      <Section title="Party Mode" desc="Let guests join with a temporary QR link and limited permissions.">
        <PartyPanel />
      </Section>

      {/* ── Port ────────────────────────────────────────────────── */}
      <Section title="Server Port" desc="Port the server listens on. Changing this requires a restart.">
        <Field label="Port">
          <input
            type="number"
            value={form.port}
            onChange={e => patch({ port: parseInt(e.target.value, 10) || 4440 })}
            onBlur={onBlurSave}
            className="w-32 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
          />
        </Field>
      </Section>

    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {children}
    </div>
  );
}

function ModeCard({ active, onClick, icon, title, desc }: {
  active: boolean; onClick: () => void; icon: string; title: string; desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl p-3 border-2 transition ${
        active ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700 bg-gray-800 hover:border-gray-600'
      }`}
    >
      <div className="text-xl mb-0.5">{icon}</div>
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="text-xs text-gray-400">{desc}</div>
    </button>
  );
}

function GitHubIcon() {
  return (
    <svg className="w-7 h-7 text-white shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
