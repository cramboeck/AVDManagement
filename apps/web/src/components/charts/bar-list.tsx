'use client';

import { toneVar, formatCount } from './tones';

export interface BarItem {
  key: string;
  label: string;
  value: number;
}

// Nominale Kategorien: eine Serie, eine Farbe (Slot 1), Wert an der Spitze.
// Balken <=24px, 4px gerundetes Datenende, keine Legende (der Titel benennt die Serie).
export function BarList({ items, maxItems = 8 }: { items: BarItem[]; maxItems?: number }) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, maxItems);
  const rest = sorted.slice(maxItems);
  if (rest.length > 0) {
    shown.push({ key: '__other', label: `Andere (${rest.length})`, value: rest.reduce((s, i) => s + i.value, 0) });
  }
  const max = Math.max(1, ...shown.map((i) => i.value));

  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Daten.</p>;
  }

  return (
    <ul className="space-y-2" role="list">
      {shown.map((item) => {
        const percent = (item.value / max) * 100;
        const other = item.key === '__other';
        return (
          <li key={item.key} className="grid grid-cols-[minmax(6rem,40%)_1fr_3rem] items-center gap-3 text-sm">
            <span className="truncate" title={item.label}>
              {item.label}
            </span>
            <span className="h-4 w-full" aria-hidden="true">
              <span
                className="block h-full rounded-r"
                style={{ width: `${percent}%`, backgroundColor: other ? toneVar.neutral : toneVar.series, minWidth: item.value > 0 ? 3 : 0 }}
              />
            </span>
            <span className="text-right tabular-nums">{formatCount(item.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
