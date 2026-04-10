import { useState } from 'react';
import type { SafeConfig } from '../setupApi';

interface Props {
  auth: SafeConfig['auth'];
  port: number;
  onChange: (auth: SafeConfig['auth']) => void;
  onNext: () => void;
  onBack: () => void;
}

export function AuthStep({ auth, port, onChange, onNext, onBack }: Props) {
  const [showSecret, setShowSecret] = useState(false);
  // Keep raw textarea text in local state so Enter key works naturally.
  // Only parse into the emails array on blur.
  const [emailsRaw, setEmailsRaw] = useState(auth.google.allowedEmails.join('\n'));

  function setMode(mode: 'none' | 'google') {
    onChange({ ...auth, mode });
  }

  function setGoogle(patch: Partial<SafeConfig['auth']['google']>) {
    onChange({ ...auth, google: { ...auth.google, ...patch } });
  }

  function handleEmailsChange(raw: string) {
    setEmailsRaw(raw);
  }

  function handleEmailsBlur() {
    const emails = emailsRaw.split('\n').map(e => e.trim().toLowerCase()).filter(Boolean);
    setGoogle({ allowedEmails: emails });
  }

  const defaultCallback = `http://localhost:${port}/auth/google/callback`;

  const canProceed =
    auth.mode === 'none' ||
    (auth.mode === 'google' && !!auth.google.clientId && !!auth.google.clientSecret);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Authentication</h2>
        <p className="text-gray-400 text-sm">
          Control who can access Clone Sidekick. If you're running it only on your local network, "No authentication" is fine.
        </p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3">
        <ModeCard
          active={auth.mode === 'none'}
          onClick={() => setMode('none')}
          icon="🔓"
          title="No Authentication"
          desc="Anyone on your network can use it. Recommended for local / LAN use."
        />
        <ModeCard
          active={auth.mode === 'google'}
          onClick={() => setMode('google')}
          icon="🔐"
          title="Google OAuth"
          desc="Users sign in with Google. Required for safe internet (WAN) access."
        />
      </div>

      {/* Google fields */}
      {auth.mode === 'google' && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-4">
          <div className="text-sm text-gray-300 bg-blue-900/30 rounded-lg px-3 py-2.5 space-y-1">
            <p className="font-semibold text-blue-300">Setup instructions</p>
            <ol className="list-decimal list-inside text-gray-400 space-y-0.5 text-xs">
              <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Google Cloud Console → Credentials</a></li>
              <li>Create an OAuth 2.0 Client ID (type: Web application)</li>
              <li>Add the callback URL below to "Authorized redirect URIs"</li>
              <li>Copy the Client ID and Secret into the fields below</li>
            </ol>
          </div>

          <Field label="Client ID">
            <input
              type="text"
              value={auth.google.clientId}
              onChange={e => setGoogle({ clientId: e.target.value })}
              placeholder="123456789-abc….apps.googleusercontent.com"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
          </Field>

          <Field label="Client Secret">
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={auth.google.clientSecret}
                onChange={e => setGoogle({ clientSecret: e.target.value })}
                placeholder="GOCSPX-…"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 pr-16"
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

          <Field label="Callback URL" hint="Add this URL to Google Console. Will be overridden to match your tunnel if enabled.">
            <input
              type="text"
              value={auth.google.callbackUrl || defaultCallback}
              onChange={e => setGoogle({ callbackUrl: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              If you enable a Cloudflare Tunnel in the next step, this will automatically be updated to use your tunnel hostname.
            </p>
          </Field>

          <Field label="Allowed Emails" hint="One per line. Leave empty to allow any Google account.">
            <textarea
              rows={5}
              value={emailsRaw}
              onChange={e => handleEmailsChange(e.target.value)}
              onBlur={handleEmailsBlur}
              placeholder={"you@gmail.com\nfriend@gmail.com"}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-y min-h-[7rem]"
            />
          </Field>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-5 py-2 text-sm text-gray-400 hover:text-white transition">
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: string; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl p-4 border-2 transition ${active ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{label}</label>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {children}
    </div>
  );
}
