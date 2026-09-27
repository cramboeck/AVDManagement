/**
 * Protokolle von Workern zusammenfuehren
 *
 * Worker melden Zeilen waehrend des Laufs (mit Zeitstempel der API) und
 * schicken am Ende ihr komplettes Protokoll noch einmal mit. Ohne Abgleich
 * stand jede Zeile doppelt im Paket. Verglichen wird der Text ohne
 * Zeitstempel und Stufe.
 */

const PREFIX = /^\[[^\]]*\]\s*(\[[A-Z]+\]\s*)?/;

function normalise(line: string): string {
  return line.replace(PREFIX, '').trim();
}

export function mergeWorkerLogs(streamed: string | null | undefined, final: string | null | undefined, maxChars: number): string | null {
  const seen = new Set((streamed ?? '').split('\n').map(normalise).filter(Boolean));
  const extra = (final ?? '')
    .split('\n')
    .filter((line) => {
      const text = normalise(line);
      return text.length > 0 && !seen.has(text);
    });
  const merged = [streamed?.trim(), extra.join('\n').trim()].filter((s) => s && s.length > 0).join('\n');
  return merged ? merged.slice(-maxChars) : null;
}
