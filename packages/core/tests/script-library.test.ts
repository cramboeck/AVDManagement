/**
 * Tests fuer die Skriptbibliothek: Ladbarkeit, Konventionen, Kennzeichnung
 */

import { describe, it, expect } from 'vitest';
import {
  loadScriptLibrary,
  getLibraryScript,
  computeScriptHash,
  parseScriptOutput,
  parseTenantDescription,
  tenantDescription,
  tenantDisplayName,
} from '../src/scripts/library.js';

// Pipeline-Aliase und Kurzformen, die PowerShell 5.1-Skripte nicht enthalten duerfen
const ALIAS_PATTERNS = [
  // Alias direkt hinter der Pipe; "Select-Object" ist erlaubt, "select" nicht
  /\|\s*(%|\?|foreach|where|select|sort|ft|fl|fw|measure|group|tee)(?![-\w])/i,
  /(^|[\s(;{])(gci|ls|dir|cat|gc|iex|irm|iwr|sls|gm|gwmi|gcim|echo|type|rm|del|cp|mv|ni|sc|sleep|start|kill|ps|gps|gsv|sasv|spsv)\s/im,
];

describe('script library', () => {
  const scripts = loadScriptLibrary();

  it('loads the library scripts with stable hashes', () => {
    expect(scripts.map((s) => s.id)).toEqual(['update-status', 'update-scan', 'system-info', 'winget-updates']);
    for (const script of scripts) {
      expect(script.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(script.hash).toBe(computeScriptHash(script.version, script.detectionScript, script.remediationScript));
      expect(script.detectionScript.length).toBeGreaterThan(200);
    }
    expect(getLibraryScript('update-scan')?.hasRemediation).toBe(true);
    expect(getLibraryScript('system-info')?.hasRemediation).toBe(false);
    expect(getLibraryScript('nope')).toBeNull();
  });

  it('keeps every script ASCII-only, alias-free and free of user data lookups', () => {
    for (const script of scripts) {
      const bodies = [script.detectionScript, script.remediationScript].filter((b): b is string => b !== null);
      for (const body of bodies) {
        expect(body).toMatch(/^[\x00-\x7f]*$/);
        for (const pattern of ALIAS_PATTERNS) {
          expect(body, `${script.id} uses an alias matching ${pattern}`).not.toMatch(pattern);
        }
        // Keine Benutzernamen: weder aus WMI noch aus der Umgebung
        expect(body).not.toMatch(/\bUserName\b|\$env:USERNAME|Get-LocalUser|quser|query user/i);
        // Jede Erkennung endet mit einer JSON-Zeile
        expect(body).toMatch(/ConvertTo-Json/);
        expect(body).toMatch(/^exit [01]\s*$/m);
      }
    }
  });

  it('names and marks tenant objects so drift is detectable', () => {
    const script = getLibraryScript('update-status')!;
    expect(tenantDisplayName(script)).toBe('ZSC-update-status');
    const description = tenantDescription(script);
    expect(parseTenantDescription(description)).toEqual({ hash: script.hash, version: script.version });
    expect(parseTenantDescription('irgendwas ohne Marker')).toBeNull();
  });

  it('parses only JSON object output', () => {
    expect(parseScriptOutput('{"schema":"zsc.system-info/1","uptimeHours":3.5}')).toEqual({ schema: 'zsc.system-info/1', uptimeHours: 3.5 });
    expect(parseScriptOutput('  {"a":1}\r\n')).toEqual({ a: 1 });
    expect(parseScriptOutput('Access denied')).toBeNull();
    expect(parseScriptOutput('[1,2]')).toBeNull();
    expect(parseScriptOutput('{"truncated by intune')).toBeNull();
    expect(parseScriptOutput(null)).toBeNull();
  });
});
