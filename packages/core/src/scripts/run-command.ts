/**
 * Bibliotheksskripte ueber Azure Run Command (Session Hosts, Azure-VMs)
 *
 * Run Command fuehrt genau ein Skript aus. Damit die Bibliothek unveraendert
 * bleibt, schreibt ein Rahmenskript Erkennung und Behebung als Dateien,
 * fuehrt sie wie Intune aus (Erkennung, bei Exit 1 Behebung, dann erneut
 * Erkennung) und markiert die Ausgabe, damit sie sich sicher parsen laesst.
 */

import type { LoadedScript } from './library.js';

const RESULT_BEGIN = 'ZSC-RESULT-BEGIN';
const RESULT_END = 'ZSC-RESULT-END';
const EXIT_PREFIX = 'ZSC-EXIT:';
const REMEDIATION_PREFIX = 'ZSC-REMEDIATION:';

export interface RunCommandOutcome {
  // Ausgabe der letzten Erkennung (nach Behebung, falls sie lief)
  output: string | null;
  exitCode: number | null;
  // none: keine Behebung im Skript; skipped: Erkennung war 0; ran: Behebung lief mit diesem Exit-Code
  remediation: { state: 'none' | 'skipped' | 'ran'; exitCode: number | null };
  stderr: string | null;
}

function hereString(content: string): string {
  // Ein Here-String endet an einer Zeile, die mit '@ beginnt; die Bibliothek enthaelt so etwas nicht
  if (/^'@/m.test(content)) {
    throw new Error('Script contains a here-string terminator and cannot be embedded');
  }
  return `@'\n${content.replace(/\r\n/g, '\n')}\n'@`;
}

/**
 * Rahmenskript fuer Run Command. Rueckgabe als Zeilen, wie die Compute-API es erwartet.
 */
export function buildRunCommandScript(script: LoadedScript): string[] {
  const lines: string[] = [
    `$ErrorActionPreference = 'Continue'`,
    `$root = Join-Path -Path $env:ProgramData -ChildPath 'ZeroStress\\runcommand'`,
    `New-Item -Path $root -ItemType Directory -Force | Out-Null`,
    `$detectPath = Join-Path -Path $root -ChildPath '${script.id}.detect.ps1'`,
    `[System.IO.File]::WriteAllText($detectPath, ${hereString(script.detectionScript)}, [System.Text.Encoding]::ASCII)`,
    `function Invoke-Zsc { param([string]$Path) $text = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Path 2>&1 | Out-String; return @{ text = $text; code = $LASTEXITCODE } }`,
    `$first = Invoke-Zsc -Path $detectPath`,
    `$final = $first`,
    `$remediation = 'none'`,
    `$remediationCode = ''`,
  ];
  if (script.remediationScript) {
    lines.push(
      `$remediatePath = Join-Path -Path $root -ChildPath '${script.id}.remediate.ps1'`,
      `[System.IO.File]::WriteAllText($remediatePath, ${hereString(script.remediationScript)}, [System.Text.Encoding]::ASCII)`,
      `$remediation = 'skipped'`,
      `if ($first.code -eq 1) {`,
      `  $fix = Invoke-Zsc -Path $remediatePath`,
      `  $remediation = 'ran'`,
      `  $remediationCode = [string]$fix.code`,
      `  $final = Invoke-Zsc -Path $detectPath`,
      `}`
    );
  }
  lines.push(
    `Write-Output '${RESULT_BEGIN}'`,
    `Write-Output ([string]$final.text).Trim()`,
    `Write-Output '${RESULT_END}'`,
    `Write-Output ('${EXIT_PREFIX}' + [string]$final.code)`,
    `Write-Output ('${REMEDIATION_PREFIX}' + $remediation + ':' + $remediationCode)`,
    `Remove-Item -Path $root -Recurse -Force -ErrorAction SilentlyContinue`
  );
  return lines;
}

/**
 * Ausgabe von Run Command deuten (StdOut und StdErr der Compute-API).
 */
export function parseRunCommandOutput(stdout: string | null, stderr: string | null): RunCommandOutcome {
  const text = (stdout ?? '').replace(/\r\n/g, '\n');
  const begin = text.indexOf(RESULT_BEGIN);
  const end = text.indexOf(RESULT_END);
  let output: string | null = null;
  if (begin >= 0 && end > begin) {
    output = text.slice(begin + RESULT_BEGIN.length, end).trim() || null;
  } else if (text.trim()) {
    // Rahmen fehlt (z. B. Ausgabe abgeschnitten): Rohtext behalten
    output = text.trim();
  }

  const exitMatch = new RegExp(`^${EXIT_PREFIX}(-?\\d+)\\s*$`, 'm').exec(text);
  const remediationMatch = new RegExp(`^${REMEDIATION_PREFIX}(none|skipped|ran):(-?\\d*)\\s*$`, 'm').exec(text);

  return {
    output,
    exitCode: exitMatch ? Number(exitMatch[1]) : null,
    remediation: {
      state: (remediationMatch?.[1] as 'none' | 'skipped' | 'ran' | undefined) ?? 'none',
      exitCode: remediationMatch && remediationMatch[2] !== '' ? Number(remediationMatch[2]) : null,
    },
    stderr: stderr?.trim() || null,
  };
}
