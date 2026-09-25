'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { type Tone, toneVar, toneGlyph, formatCount, formatPercent } from './tones';

export interface StackedSegment {
  key: string;
  label: string;
  count: number;
  tone: Tone;
}

// Horizontaler Teil-zum-Ganzen-Balken: <=24px dick, 2px Oberflaechenluecke
// zwischen Segmenten, Legende mit Icon+Label+Wert, Tooltip pro Segment
export function StackedBar({ segments, total }: { segments: StackedSegment[]; total?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const sum = total ?? segments.reduce((s, seg) => s + seg.count, 0);
  const visible = segments.filter((s) => s.count > 0);

  if (sum === 0) {
    return <p className="text-sm text-muted-foreground">Keine Daten.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={visible.map((s) => `${s.label}: ${s.count}`).join(', ')}>
        {visible.map((s, index) => {
          const percent = (s.count / sum) * 100;
          const isActive = active === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              aria-label={`${s.label}: ${formatCount(s.count)} (${formatPercent(percent, 1)})`}
              className={clsx(
                'relative h-full min-w-[3px] transition-opacity focus:outline-none',
                index === visible.length - 1 && 'rounded-r',
                active && !isActive && 'opacity-60'
              )}
              style={{ width: `${percent}%`, backgroundColor: toneVar[s.tone] }}
            >
              {isActive && (
                <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-background px-2 py-1 text-xs shadow-md">
                  <span className="font-semibold">{formatCount(s.count)}</span>
                  <span className="ml-1 text-muted-foreground">
                    {s.label} · {formatPercent(percent, 1)}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <li key={s.key} className={clsx('flex items-center gap-1.5', s.count === 0 && 'text-muted-foreground')}>
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: toneVar[s.tone] }} aria-hidden="true" />
            {toneGlyph[s.tone] && <span aria-hidden="true" className="text-muted-foreground">{toneGlyph[s.tone]}</span>}
            <span>{s.label}</span>
            <span className="tabular-nums font-medium">{formatCount(s.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
