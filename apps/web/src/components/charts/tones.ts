// Farbrollen der Diagramme: Status ist fest reserviert, "series" ist die eine
// kategoriale Serienfarbe, "neutral" die De-Emphasis-Farbe fuer Rest/Unbekannt
export type Tone = 'series' | 'good' | 'warning' | 'serious' | 'critical' | 'neutral';

export const toneVar: Record<Tone, string> = {
  series: 'var(--viz-series-1)',
  good: 'var(--viz-good)',
  warning: 'var(--viz-warning)',
  serious: 'var(--viz-serious)',
  critical: 'var(--viz-critical)',
  neutral: 'var(--viz-neutral)',
};

// Status-Icons, damit Bedeutung nie nur an der Farbe haengt
export const toneGlyph: Record<Tone, string> = {
  series: '',
  good: '✓',
  warning: '!',
  serious: '!!',
  critical: '✕',
  neutral: '·',
};

export function formatCount(value: number): string {
  return new Intl.NumberFormat('de-DE').format(value);
}

export function formatPercent(value: number, digits = 0): string {
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(value)} %`;
}
