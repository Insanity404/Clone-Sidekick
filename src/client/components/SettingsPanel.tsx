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
  const [emailsRaw, setEmailsRaw] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [secretEdited, setSecretEdited] = useState(false);
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

      {/* ── About & Support ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-stretch gap-4">
        <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span>🎸</span> About Clone Sidekick
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
            straight into your songs folder &mdash; no manual ZIP wrangling
            needed. From the couch to the PC!
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">
            This is a free, open-source project built for the Clone Hero
            community. If you find it useful and want to support continued
            development, a small donation on Ko-fi goes a long way!
          </p>
        </div>
        <div className="sm:w-[330px] shrink-0 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <iframe
            src="https://ko-fi.com/1nsanity/?hidefeed=true&widget=true&embed=true&preview=true"
            className="w-full border-none"
            style={{ border: 'none', width: '100%', padding: 4, background: '#f9f9f9' }}
            height="712"
            title="Support on Ko-fi"
          />
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
          <div className="mt-3">
            <Field label="Hostname" hint="e.g. guitar.example.com">
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
