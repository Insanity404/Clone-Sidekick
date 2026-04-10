import type { AppConfigTunnel } from '../../../shared/types';

interface Props {
  tunnel: AppConfigTunnel;
  onChange: (tunnel: AppConfigTunnel) => void;
  onNext: () => void;
  onBack: () => void;
}

export function TunnelStep({ tunnel, onChange, onNext, onBack }: Props) {
  const canProceed = !tunnel.enabled || !!tunnel.hostname.trim();

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
          <div className="text-sm bg-blue-900/30 rounded-lg px-3 py-2.5 space-y-1">
            <p className="font-semibold text-blue-300">Prerequisites</p>
            <ol className="list-decimal list-inside text-gray-400 space-y-0.5 text-xs">
              <li>
                Install <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">cloudflared</a> for your platform
              </li>
              <li>Run <code className="bg-gray-900 px-1 rounded">cloudflared tunnel login</code> once to authenticate</li>
            </ol>
            <p className="text-gray-500 mt-1">The tunnel, DNS route, and config file will be created automatically when you save.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Hostname</label>
            <p className="text-xs text-gray-500">The domain you'll route to this app (e.g. guitar.example.com)</p>
            <input
              type="text"
              value={tunnel.hostname}
              onChange={e => onChange({ ...tunnel, hostname: e.target.value })}
              placeholder="guitar.example.com"
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
