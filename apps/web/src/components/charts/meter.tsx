'use client';

import clsx from 'clsx';
import { type Tone, toneVar, toneGlyph, formatPercent } from './tones';

interface MeterProps {
  label: string;
  // 0-100
  percent: number;
  tone: Tone;
  detail?: string;
  // Vergleichsmarke auf der Skala (z. B. Durchschnitt aller Tenants)
  marker?: { percent: number; label: string } | null;
  // Bei "niedriger ist besser" (Exposure) wird die Skala invertiert beschriftet
  valueText?: string;
}

// Meter: Fuellung traegt die Bewertung (Status-Ton), die Spur ist eine hellere Stufe derselben Farbe
export function Meter({ label, percent, tone, detail, marker, valueText }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const fill = toneVar[tone];

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{label}</span>
        <span className="text-lg font-semibold">
          {toneGlyph[tone] && (
            <span aria-hidden="true" className="mr-1 text-sm text-muted-foreground">
              {toneGlyph[tone]}
            </span>
          )}
          {valueText ?? formatPercent(clamped)}
        </span>
      </div>
      <div
        className="relative h-2.5 w-full rounded-full"
        style={{ backgroundColor: tone === 'series' ? 'var(--viz-track)' : `color-mix(in srgb, ${fill} 22%, transparent)` }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={label}
      >
        <div className={clsx('h-full rounded-full')} style={{ width: `${clamped}%`, backgroundColor: fill }} />
        {marker && (
          <div
            className="absolute -top-1 h-4.5 w-0.5 bg-foreground/60"
            style={{ left: `calc(${Math.max(0, Math.min(100, marker.percent))}% - 1px)`, height: '1.125rem' }}
            title={`${marker.label}: ${formatPercent(marker.percent)}`}
            aria-hidden="true"
          />
        )}
      </div>
      {(detail || marker) && (
        <p className="text-xs text-muted-foreground">
          {detail}
          {detail && marker && ' · '}
          {marker && `${marker.label}: ${formatPercent(marker.percent)}`}
        </p>
      )}
    </div>
  );
}
