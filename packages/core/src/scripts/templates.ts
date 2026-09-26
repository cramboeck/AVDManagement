/**
 * Skriptvorlagen mit Platzhaltern (Admin auf Zeit)
 *
 * Anders als die Bibliothek brauchen diese Skripte Parameter je Lauf.
 * Weil Intune Remediations keine Parameter kennen, fuellt die Konsole die
 * Platzhalter, legt das Skript einmalig im Tenant an und loescht es nach
 * dem Lauf. Jeder Wert wird streng geprueft, bevor er in das Skript kommt.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isWingetId } from '../apps/winget.js';

export type TemplateId = 'temp-admin-grant' | 'temp-admin-revoke' | 'winget-install';

const files: Record<TemplateId, string> = {
  'temp-admin-grant': 'temp-admin.grant.ps1',
  'temp-admin-revoke': 'temp-admin.revoke.ps1',
  'winget-install': 'winget-install.ps1',
};

const WINGET_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
export type WingetInstallMode = 'install' | 'upgrade';

// Lokaler Kontoname, Entra-Konto (AzureAD\upn) oder SID; kein Zeichen, das PowerShell-Syntax bricht
const ACCOUNT_PATTERN = /^(AzureAD\\[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9._-]{1,64}|S-1-[0-9-]{5,60})$/;
const TASK_NAME_PATTERN = /^[A-Za-z0-9._-]{4,60}$/;
export const TEMP_ADMIN_MIN_MINUTES = 15;
export const TEMP_ADMIN_MAX_MINUTES = 240;

const cache = new Map<TemplateId, string>();

function readTemplate(id: TemplateId): string {
  const cached = cache.get(id);
  if (cached) return cached;
  const content = readFileSync(new URL(`../../scripts/${files[id]}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  if (/[^\x00-\x7f]/.test(content)) throw new Error(`Template ${id} contains non-ASCII characters`);
  cache.set(id, content);
  return content;
}

export function validateAccountName(account: string): string {
  // Entra-Praefix in fester Schreibweise, damit Aufgabenname und Vergleich stabil sind
  const trimmed = account.trim().replace(/^azuread\\/i, 'AzureAD\\');
  if (!ACCOUNT_PATTERN.test(trimmed)) {
    throw new Error("Kontoname ungueltig: erlaubt sind lokale Namen, 'AzureAD\\\\name@domain' oder eine SID");
  }
  return trimmed;
}

export function validateMinutes(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < TEMP_ADMIN_MIN_MINUTES || minutes > TEMP_ADMIN_MAX_MINUTES) {
    throw new Error(`Dauer muss zwischen ${TEMP_ADMIN_MIN_MINUTES} und ${TEMP_ADMIN_MAX_MINUTES} Minuten liegen`);
  }
  return minutes;
}

/**
 * Aufgabenname je Konto und Geraet, damit ein zweiter Lauf die erste Aufgabe ersetzt.
 */
export function tempAdminTaskName(account: string): string {
  const hash = createHash('sha256').update(account.toLowerCase()).digest('hex').slice(0, 10);
  return `ZSC-TempAdmin-${hash}`;
}

export interface RenderedTemplate {
  id: TemplateId;
  content: string;
  hash: string;
}

export function renderTempAdminGrant(input: { account: string; minutes: number }): RenderedTemplate {
  const account = validateAccountName(input.account);
  const minutes = validateMinutes(input.minutes);
  const taskName = tempAdminTaskName(account);
  if (!TASK_NAME_PATTERN.test(taskName)) throw new Error('Task name invalid');
  const content = readTemplate('temp-admin-grant').replace('__ACCOUNT__', account.replace(/'/g, "''")).replace('__MINUTES__', String(minutes)).replace('__TASKNAME__', taskName);
  return { id: 'temp-admin-grant', content, hash: createHash('sha256').update(content).digest('hex') };
}

export function renderTempAdminRevoke(input: { account: string }): RenderedTemplate {
  const account = validateAccountName(input.account);
  const taskName = tempAdminTaskName(account);
  const content = readTemplate('temp-admin-revoke').replace('__ACCOUNT__', account.replace(/'/g, "''")).replace('__TASKNAME__', taskName);
  return { id: 'temp-admin-revoke', content, hash: createHash('sha256').update(content).digest('hex') };
}

export interface WingetInstallInput {
  packageId: string;
  mode: WingetInstallMode;
  version?: string | null;
}

/**
 * winget install/upgrade auf einem Geraet: Id, Modus und Version werden
 * streng geprueft und in das Einmalskript eingebettet.
 */
export function renderWingetInstall(input: WingetInstallInput): RenderedTemplate & { packageId: string; mode: WingetInstallMode; version: string | null } {
  const packageId = input.packageId.trim();
  if (!isWingetId(packageId)) throw new Error(`winget-Id ungueltig: '${packageId}' (Form Herausgeber.Paket)`);
  if (input.mode !== 'install' && input.mode !== 'upgrade') throw new Error('Modus muss install oder upgrade sein');
  const version = input.version?.trim() || null;
  if (version && !WINGET_VERSION_PATTERN.test(version)) throw new Error(`Version ungueltig: '${version}'`);
  const content = readTemplate('winget-install').replace('__PACKAGE_ID__', packageId).replace('__MODE__', input.mode).replace('__VERSION__', version ?? '');
  return { id: 'winget-install', content, hash: createHash('sha256').update(content).digest('hex'), packageId, mode: input.mode, version };
}
