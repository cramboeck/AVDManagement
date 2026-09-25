'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { type Tone, toneVar, toneGlyph, formatCount } from './tones';

export interface ColumnSeries {
  key: string;
  label: string;
  tone: Tone;
}

export interface ColumnDatum {
  label: string;
  values: Record<string, number>;
}

// Gestapelte Saeulen ueber Zeit: 2px Oberflaechenluecke zwischen Segmenten,
// Hairline-Grid, Tooltip mit allen Serien pro Spalte, Legende mit Icon+Label
export function ColumnChart({ series, data, height = 160 }: { series: ColumnSeries[]; data: ColumnDatum[]; height?: number }) {
  const [active, setActive] = useState<number | null>(null);

  const totals = data.map((d) => series.reduce((s, ser) => s + (d.values[ser.key] ?? 0), 0));
  const max = Math.max(...totals, 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Daten.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-right text-[10px] tabular-nums text-muted-foreground" style={{ height }}>
          {[...ticks].reverse().map((t) => (
            <span key={t}>{formatCount(t)}</span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute left-0 right-0"
              style={{ bottom: `${(t / top) * 100}%`, borderTop: '1px solid var(--viz-grid)' }}
              aria-hidden="true"
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-2">
            {data.map((d, index) => {
              const total = totals[index];
              const isActive = active === index;
              return (
                <button
                  key={d.label}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  aria-label={`${d.label}: ${series.map((s) => `${s.label} ${formatCount(d.values[s.key] ?? 0)}`).join(', ')}`}
                  className={clsx('relative flex h-full flex-1 flex-col-reverse items-stretch justify-start focus:outline-none', active !== null && !isActive && 'opacity-60')}
                >
                  <span className="mx-auto flex w-full max-w-[24px] flex-col-reverse gap-[2px]" style={{ height: `${(total / top) * 100}%` }}>
                    {series.map((s, si) => {
                      const v = d.values[s.key] ?? 0;
                      if (v === 0) return null;
                      const lastVisible = series.slice(si + 1).every((later) => (d.values[later.key] ?? 0) === 0);
                      return (
                        <span
                          key={s.key}
                          className={clsx('block w-full', lastVisible && 'rounded-t')}
                          style={{ flexGrow: v, flexBasis: 0, backgroundColor: toneVar[s.tone], minHeight: 2 }}
                          aria-hidden="true"
                        />
                      );
                    })}
                  </span>
                  {isActive && (
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-background px-2 py-1 text-left text-xs shadow-md">
                      <span className="block font-medium">{d.label}</span>
                      {series.map((s) => (
                        <span key={s.key} className="flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-3" style={{ backgroundColor: toneVar[s.tone] }} aria-hidden="true" />
                          <span className="font-semibold tabular-nums">{formatCount(d.values[s.key] ?? 0)}</span>
                          <span className="text-muted-foreground">{s.label}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="absolute bottom-0 left-0 right-0" style={{ borderTop: '1px solid var(--viz-axis)' }} aria-hidden="true" />
        </div>
      </div>
      <div className="ml-8 flex gap-2 text-[10px] text-muted-foreground">
        {data.map((d) => (
          <span key={d.label} className="flex-1 truncate text-center">
            {d.label}
          </span>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: toneVar[s.tone] }} aria-hidden="true" />
            {toneGlyph[s.tone] && <span aria-hidden="true" className="text-muted-foreground">{toneGlyph[s.tone]}</span>}
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Runde Achsenwerte: 0 ... Obergrenze in 4 Schritten
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let t = 0; t < max + step; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return ticks;
}
