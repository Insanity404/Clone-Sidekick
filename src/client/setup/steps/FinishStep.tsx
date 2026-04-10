import { useState } from 'react';
import { saveSetupConfig } from '../setupApi';
import type { SafeConfig } from '../setupApi';

interface Props {
  formData: SafeConfig;
  onBack: () => void;
}

export function FinishStep({ formData, onBack }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await saveSetupConfig(formData as any);
      if (result.ok) {
        setSaved(true);
        setRestartRequired(result.restartRequired ?? false);
        setExternalUrl(result.externalUrl ?? null);
      } else {
        setError(result.error ?? 'Unknown error');
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    const launchUrl = externalUrl || '/';
    return (
      <div className="flex flex-col items-center text-center gap-6 py-4">
        <div className="text-5xl">✅</div>
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Setup Complete!</h2>
          <p className="text-gray-400">Your configuration has been saved.</p>
        </div>
        {restartRequired ? (
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl px-5 py-4 text-sm text-yellow-300 max-w-sm">
            <p className="font-semibold mb-1">Restart required</p>
            <p>You changed the port. Please restart the server, then visit:</p>
            <p className="mt-1 font-mono text-yellow-200">http://localhost:{formData.port}</p>
          </div>
        ) : (
          <>
            {externalUrl && (
              <div className="bg-gray-800 rounded-xl px-5 py-3 text-sm text-gray-300 max-w-sm">
                <p>The tunnel may take a few seconds to connect.</p>
                <p className="mt-1 font-mono text-purple-300">{externalUrl}</p>
              </div>
            )}
            <button
              onClick={() => { window.location.href = launchUrl; }}
              className="px-8 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg transition"
            >
              Open Clone Sidekick →
            </button>
          </>
        )}
      </div>
    );
  }

  // Compute the actual callback URL the server will use
  const computedCallbackUrl = formData.tunnel.enabled && formData.tunnel.hostname
    ? `https://${formData.tunnel.hostname}/auth/google/callback`
    : `http://localhost:${formData.port}/auth/google/callback`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Review & Save</h2>
        <p className="text-gray-400 text-sm">Check your settings below, then save to finish setup.</p>
      </div>

      <div className="bg-gray-800 rounded-xl divide-y divide-gray-700 overflow-hidden text-sm">
        <Row label="Port" value={String(formData.port)} />
        <Row label="Songs Directory" value={formData.cloneHeroSongsDir || '(not set)'} mono />
        <Row label="Authentication" value={formData.auth.mode === 'none' ? 'None (LAN only)' : 'Google OAuth'} />
        {formData.auth.mode === 'google' && (
          <>
            <Row label="Google Client ID" value={formData.auth.google.clientId || '(not set)'} mono />
            <Row label="Google Secret" value={formData.auth.google.clientSecret || '(not set)'} />
            <Row label="Callback URL" value={computedCallbackUrl} mono />
            <Row
              label="Allowed Emails"
              value={formData.auth.google.allowedEmails.length > 0
                ? formData.auth.google.allowedEmails.join(', ')
                : 'Any Google account'}
            />
          </>
        )}
        <Row label="Remote Access" value={formData.tunnel.enabled ? `Cloudflare Tunnel (${formData.tunnel.hostname || 'no hostname'})` : 'Local only'} />
      </div>

      {error && (
        <div className="bg-red-900/40 text-red-300 rounded-lg px-4 py-3 text-sm">
          ✗ {error}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-5 py-2 text-sm text-gray-400 hover:text-white transition">
          ← Back
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
        >
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className={`text-white text-right truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}
