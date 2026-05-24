import { useState } from 'react';
import type { AppConfigTunnel } from '../../../shared/types';

interface Props {
  tunnel: AppConfigTunnel;
  onChange: (tunnel: AppConfigTunnel) => void;
  onNext: () => void;
  onBack: () => void;
}

export function TunnelStep({ tunnel, onChange, onNext, onBack }: Props) {
  const [showToken, setShowToken] = useState(false);
  const canProceed = !tunnel.enabled || (!!tunnel.hostname.trim() && !!tunnel.token.trim());

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Remote Access</h2>
        <p className="text-gray-400 text-sm">
          By default Clone Sidekick is only accessible on your local network. Cloudflare Tunnel
          can expose it securely to the internet without opening firewall ports.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ModeCard
          active={!tunnel.enabled}
          onClick={() => onChange({ ...tunnel, enabled: false })}
          icon="🏠"
          title="Local Only"
          desc="Accessible on your home network. No extra setup needed."
        />
        <ModeCard
          active={tunnel.enabled}
          onClick={() => onChange({ ...tunnel, enabled: true })}
          icon="🌐"
          title="Cloudflare Tunnel"
          desc="Secure internet access via a Cloudflare-managed tunnel."
        />
      </div>

      {tunnel.enabled && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-4">
          <div className="text-sm bg-blue-900/30 rounded-lg px-3 py-2.5 space-y-1.5">
            <p className="font-semibold text-blue-300">How to set up your tunnel</p>
            <ol className="list-decimal list-inside text-gray-400 space-y-1 text-xs">
              <li>
                Open{' '}
                <a href="https://one.cloudflare.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                  one.cloudflare.com
                </a>{' '}
                → Networks → Tunnels → <strong className="text-gray-300">Create a tunnel</strong>
              </li>
              <li>Choose <strong className="text-gray-300">Cloudflared</strong>, give it a name (e.g. <em>sidekick</em>)</li>
              <li>
                Under <strong className="text-gray-300">Public Hostnames</strong>, add:<br />
                <code className="bg-gray-900 px-1 rounded text-gray-300">guitar.yourdomain.com</code> → <code className="bg-gray-900 px-1 rounded text-gray-300">http://localhost:4440</code>
              </li>
              <li>Copy the <strong className="text-gray-300">tunnel token</strong> shown on the next screen</li>
            </ol>
            <p className="text-gray-500 text-xs mt-1">
              Make sure <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">cloudflared</a> is installed — the app will connect automatically using your token.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Tunnel Token</label>
            <p className="text-xs text-gray-500">Paste the token from the Cloudflare dashboard</p>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={tunnel.token}
                onChange={e => onChange({ ...tunnel, token: e.target.value })}
                placeholder="eyJh…"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 pr-14 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={() => setShowToken(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Your Hostname</label>
            <p className="text-xs text-gray-500">The domain you configured above (used to generate share links)</p>
            <input
              type="text"
              value={tunnel.hostname}
              onChange={e => onChange({ ...tunnel, hostname: e.target.value })}
              placeholder="guitar.yourdomain.com"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
          </div>
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
