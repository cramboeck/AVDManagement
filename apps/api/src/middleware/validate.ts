/**
 * Zod-Validierung mit Problem-Details-Antwort
 *
 * Der rohe zod-validator antwortet bei Fehlern mit dem Zod-Ergebnisobjekt
 * ohne title; die Oberflaeche zeigte dann eine leere Fehlerbox. Hier wird
 * das erste Problem als lesbarer Satz in detail geliefert, alle Probleme
 * stehen unter issues.
 */

import { zValidator } from '@hono/zod-validator';
import type { ZodSchema, ZodIssue } from 'zod';

type Target = 'json' | 'query' | 'param' | 'form' | 'header';

function describe(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
  return `${path}: ${issue.message}`;
}

export function validate<T extends ZodSchema, K extends Target>(target: K, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return undefined;
    const issues = result.error.issues;
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/validation',
        title: 'Eingabe ungueltig',
        detail: issues.slice(0, 3).map(describe).join('; '),
        status: 400,
        issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
      },
      400
    );
  });
}
