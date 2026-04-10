import { useState, useEffect } from 'react';
import { validateDir } from '../setupApi';

interface Props {
  value: string;
  suggestion: string;
  onChange: (dir: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function SongsDirStep({ value, suggestion, onChange, onNext, onBack }: Props) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; warning?: string; error?: string } | null>(null);
  const [input, setInput] = useState(value || suggestion);

  // Auto-populate suggestion on first render if no value set
  useEffect(() => {
    if (!value && suggestion) {
      setInput(suggestion);
      onChange(suggestion);
    }
  }, [suggestion]);

  async function handleVerify() {
    if (!input.trim()) return;
    setChecking(true);
    setResult(null);
    const r = await validateDir(input.trim());
    setResult(r);
    setChecking(false);
    if (r.ok) onChange(input.trim());
  }

  function handleChange(val: string) {
    setInput(val);
    setResult(null);
    onChange(val);
  }

  const canProceed = input.trim().length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Songs Directory</h2>
        <p className="text-gray-400 text-sm">
          Where should downloaded charts be extracted? This should be your Clone Hero <code className="bg-gray-800 px-1 rounded">Songs</code> folder.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => handleChange(e.target.value)}
          placeholder={suggestion || 'Path to Clone Hero Songs folder'}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
        />
        <button
          onClick={handleVerify}
          disabled={checking || !input.trim()}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm text-white rounded-lg transition"
        >
          {checking ? 'Checking…' : 'Verify'}
        </button>
      </div>

      {result && (
        <div className={`text-sm rounded-lg px-4 py-3 ${result.ok ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
          {result.ok
            ? result.warning ?? '✓ Directory looks good'
            : `✗ ${result.error}`}
        </div>
      )}

      {suggestion && (
        <p className="text-xs text-gray-500">
          Suggested for your system: <button onClick={() => handleChange(suggestion)} className="text-purple-400 hover:underline">{suggestion}</button>
        </p>
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
