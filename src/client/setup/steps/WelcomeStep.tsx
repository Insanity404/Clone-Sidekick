export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 py-4">
      <img src="/guitar_cape_icon_128x128.png" alt="Clone Sidekick" className="w-24 h-24" />
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Welcome to Clone Sidekick</h2>
        <p className="text-gray-400 max-w-md">
          Clone Sidekick lets you search and download custom <a href="https://clonehero.net/" className="text-purple-400 underline">Clone Hero</a> charts directly
          into your songs folder - right from your browser. Add music to your game with your phone from your couch, or on the go! It's like a sidekick for your Clone Hero experience.
        </p>
      </div>

      <div className="bg-gray-800 rounded-xl p-5 text-left w-full max-w-md space-y-3">
        <p className="text-sm font-semibold text-gray-300">This wizard will help you set up:</p>
        <ul className="space-y-2 text-sm text-gray-400">
          <li className="flex items-start gap-2"><span className="text-purple-400 mt-0.5">✓</span> Your Clone Hero songs folder location</li>
          <li className="flex items-start gap-2"><span className="text-purple-400 mt-0.5">✓</span> Authentication (optional — Google OAuth or none)</li>
          <li className="flex items-start gap-2"><span className="text-purple-400 mt-0.5">✓</span> Remote access via Cloudflare Tunnel (optional)</li>
        </ul>
      </div>

      <p className="text-xs text-gray-500">
        You can reconfigure at any time by deleting <code className="bg-gray-800 px-1 rounded">data/config.json</code> and restarting.
      </p>

      <button
        onClick={onNext}
        className="px-8 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg transition"
      >
        Get Started
      </button>
    </div>
  );
}
