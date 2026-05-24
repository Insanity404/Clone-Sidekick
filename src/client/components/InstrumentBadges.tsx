import type { ChartResult, NoteCount } from '../../shared/types';

export interface InstDef {
  key: string;
  diffKey: string;
  label: string;
  icon: string;
}

export const INST_DEFS: InstDef[] = [
  { key: 'guitar',     diffKey: 'diff_guitar',      label: 'Guitar',   icon: '/instruments/guitar.png'   },
  { key: 'bass',       diffKey: 'diff_bass',         label: 'Bass',     icon: '/instruments/bass.png'     },
  { key: 'rhythm',     diffKey: 'diff_rhythm',       label: 'Rhythm',   icon: '/instruments/rhythm.png'   },
  { key: 'drums',      diffKey: 'diff_drums',        label: 'Drums',    icon: '/instruments/drums.png'    },
  { key: 'keys',       diffKey: 'diff_keys',         label: 'Keys',     icon: '/instruments/keys.png'     },
  { key: 'vocals',     diffKey: 'diff_vocals',       label: 'Vocals',   icon: '/instruments/vocals.png'   },
  { key: 'guitarcoop', diffKey: 'diff_guitar_coop',  label: 'Co-op',    icon: '/instruments/coop.png'     },
  { key: 'guitarghl',  diffKey: 'diff_guitarghl',    label: 'GHL',      icon: '/instruments/guitarghl.png'},
  { key: 'bassghl',    diffKey: 'diff_bassghl',      label: 'GHL Bass', icon: '/instruments/bassghl.png'  },
];

const TIERS = ['expert', 'hard', 'medium', 'easy'] as const;
type Tier = (typeof TIERS)[number];

const TIER_COLOR: Record<Tier, string> = {
  expert: 'text-red-400',
  hard:   'text-orange-400',
  medium: 'text-yellow-400',
  easy:   'text-green-400',
};

function highestTier(noteCounts: NoteCount[], instKey: string): Tier | null {
  const has = new Set(noteCounts.filter(nc => nc.instrument === instKey).map(nc => nc.difficulty));
  return TIERS.find(t => has.has(t)) ?? null;
}

function intensityIcon(diff: number): string {
  if (diff === 0) return '/intensity/no-lvl.png';
  return `/intensity/${Math.min(diff, 6)}.png`;
}

export function InstrumentBadgeRow({
  chart,
  className,
  large = false,
}: {
  chart: ChartResult;
  className?: string;
  large?: boolean;
}) {
  const noteCounts = chart.notesData?.noteCounts ?? [];
  const badges = INST_DEFS
    .map(def => ({ def, diff: (chart as any)[def.diffKey] as number | null | undefined }))
    .filter(b => b.diff != null && (b.diff as number) >= 0);

  if (badges.length === 0) return null;

  const circleClass = large ? 'w-10 h-10' : 'w-8 h-8 sm:w-12 sm:h-12';
  const imgClass    = large ? 'w-6 h-6'  : 'w-5 h-5 sm:w-8 sm:h-8';
  const intClass    = large ? 'h-5'      : 'h-3.5 sm:h-6';
  const tierClass   = large ? 'text-[10px]' : 'text-[9px] sm:text-xs';
  const labelClass  = large ? 'text-[9px]'  : 'text-[8px] sm:text-[10px]';

  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      {badges.map(({ def, diff }) => {
        const d = diff as number;
        const tier = highestTier(noteCounts, def.key);
        const tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '—';
        return (
          <div
            key={def.key}
            className="flex flex-col items-center gap-0.5"
            title={`${def.label} — ${tierLabel}, difficulty ${d}${d > 6 ? ' (outlier)' : ''}`}
          >
            <span className={`${tierClass} font-semibold leading-none ${tier ? TIER_COLOR[tier] : 'text-gray-500'}`}>
              {tierLabel}
            </span>
            <div className={`${circleClass} rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center overflow-hidden`}>
              <img src={def.icon} alt={def.label} className={`${imgClass} object-contain`} />
            </div>
            <img src={intensityIcon(d)} alt={String(d)} className={`${intClass} object-contain`} />
            <span className={`${labelClass} text-gray-500 leading-none`}>{def.label}</span>
          </div>
        );
      })}
    </div>
  );
}
