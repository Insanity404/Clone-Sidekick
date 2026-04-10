import { useState, useEffect } from 'react';
import { getSetupDefaults } from './setupApi';
import type { SafeConfig } from './setupApi';
import { WelcomeStep } from './steps/WelcomeStep';
import { SongsDirStep } from './steps/SongsDirStep';
import { AuthStep } from './steps/AuthStep';
import { TunnelStep } from './steps/TunnelStep';
import { FinishStep } from './steps/FinishStep';

const STEPS = ['Welcome', 'Songs Folder', 'Authentication', 'Remote Access', 'Finish'];

interface Props {
  initial: SafeConfig;
}

export function SetupWizard({ initial }: Props) {
  const [step, setStep] = useState(0);
  const [suggestion, setSuggestion] = useState('');
  const [formData, setFormData] = useState<SafeConfig>(initial);

  useEffect(() => {
    getSetupDefaults().then(d => setSuggestion(d.songsDirSuggestion)).catch(() => {});
  }, []);

  function patch(partial: Partial<SafeConfig>) {
    setFormData(prev => ({ ...prev, ...partial }));
  }

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  return (
    <div className="min-h-dvh bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <h1 className="text-base font-bold text-white flex items-center gap-2">
          <img src="/guitar_cape_icon_32x32.png" alt="" className="w-7 h-7" />
          Clone Sidekick <span className="text-gray-500 font-normal text-sm">- Setup</span>
        </h1>
        {/* Step indicator */}
        <div className="flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} title={label} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                i < step ? 'bg-purple-500' : i === step ? 'bg-purple-400 ring-2 ring-purple-400/30' : 'bg-gray-700'
              }`} />
            </div>
          ))}
        </div>
      </header>

      {/* Step label */}
      <div className="text-center py-3">
        <span className="text-xs text-gray-500 uppercase tracking-widest">
          Step {step + 1} of {STEPS.length} - {STEPS[step]}
        </span>
      </div>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-4 pb-8">
        <div className="w-full max-w-lg">
          {step === 0 && <WelcomeStep onNext={next} />}

          {step === 1 && (
            <SongsDirStep
              value={formData.cloneHeroSongsDir}
              suggestion={suggestion}
              onChange={dir => patch({ cloneHeroSongsDir: dir })}
              onNext={next}
              onBack={back}
            />
          )}

          {step === 2 && (
            <AuthStep
              auth={formData.auth}
              port={formData.port}
              onChange={auth => patch({ auth })}
              onNext={next}
              onBack={back}
            />
          )}

          {step === 3 && (
            <TunnelStep
              tunnel={formData.tunnel}
              onChange={tunnel => patch({ tunnel })}
              onNext={next}
              onBack={back}
            />
          )}

          {step === 4 && (
            <FinishStep
              formData={formData}
              onBack={back}
            />
          )}
        </div>
      </main>
    </div>
  );
}
