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

export type TemplateId = 'temp-admin-grant' | 'temp-admin-revoke' | 'winget-install' | 'app-uninstall' | 'restart-prompt' | 'restart-cancel';

const files: Record<TemplateId, string> = {
  'temp-admin-grant': 'temp-admin.grant.ps1',
  'temp-admin-revoke': 'temp-admin.revoke.ps1',
  'winget-install': 'winget-install.ps1',
  'app-uninstall': 'app-uninstall.ps1',
  'restart-prompt': 'restart-prompt.ps1',
  'restart-cancel': 'restart-cancel.ps1',
};

const WINGET_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
export type WingetInstallMode = 'install' | 'upgrade' | 'uninstall';

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
  if (input.mode !== 'install' && input.mode !== 'upgrade' && input.mode !== 'uninstall') throw new Error('Modus muss install, upgrade oder uninstall sein');
  const version = input.version?.trim() || null;
  if (version && !WINGET_VERSION_PATTERN.test(version)) throw new Error(`Version ungueltig: '${version}'`);
  const content = readTemplate('winget-install').replace('__PACKAGE_ID__', packageId).replace('__MODE__', input.mode).replace('__VERSION__', version ?? '');
  return { id: 'winget-install', content, hash: createHash('sha256').update(content).digest('hex'), packageId, mode: input.mode, version };
}

export type AppUninstallKind = 'registry' | 'appx';

// Anzeigename wie in Apps und Features: Buchstaben, Ziffern, Leerzeichen und uebliche Satzzeichen;
// kein Backtick, kein Dollar, keine doppelten Anfuehrungszeichen, kein Zeilenumbruch
const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} .,()+_&\/:'!#@\[\]-]{2,200}$/u;
// Argumente fuer Deinstaller: Schalter, Pfade, Gleichheitszeichen; keine Shell-Operatoren
const EXTRA_ARGS_PATTERN = /^[A-Za-z0-9 \/=:._\\"'-]{1,200}$/;

export interface AppUninstallInput {
  displayName: string;
  version: string | null;
  kind: AppUninstallKind;
  extraArgs: string | null;
}

/**
 * Deinstallation ohne winget: Anzeigename (exakt), optionale Version, Art
 * (Registry oder Appx) und optionale Argumente werden geprueft und in das
 * Einmalskript eingebettet. Einfache Anfuehrungszeichen werden fuer
 * PowerShell verdoppelt.
 */
export function renderAppUninstall(input: AppUninstallInput): RenderedTemplate & { displayName: string; kind: AppUninstallKind; extraArgs: string | null } {
  const displayName = input.displayName.trim();
  if (!DISPLAY_NAME_PATTERN.test(displayName) || /[`$"\r\n]/.test(displayName)) throw new Error(`Anzeigename ungueltig oder zu kurz: '${displayName}'`);
  if (input.kind !== 'registry' && input.kind !== 'appx') throw new Error('Art muss registry oder appx sein');
  const version = input.version?.trim() || null;
  if (version && !WINGET_VERSION_PATTERN.test(version)) throw new Error(`Version ungueltig: '${version}'`);
  const extraArgs = input.extraArgs?.trim() || null;
  if (extraArgs && (!EXTRA_ARGS_PATTERN.test(extraArgs) || /[|&;<>`$]/.test(extraArgs))) throw new Error('Argumente ungueltig: erlaubt sind Schalter, Pfade und Gleichheitszeichen, keine Shell-Operatoren');
  const quote = (value: string) => value.replace(/'/g, "''");
  const content = readTemplate('app-uninstall')
    .replace('__DISPLAY_NAME__', quote(displayName))
    .replace('__VERSION__', version ? quote(version) : '')
    .replace('__KIND__', input.kind)
    .replace('__EXTRA_ARGS__', extraArgs ? quote(extraArgs) : '');
  return { id: 'app-uninstall', content, hash: createHash('sha256').update(content).digest('hex'), displayName, kind: input.kind, extraArgs };
}

// Fester Aufgabenname je Geraet: ein zweiter Plan ersetzt den ersten
export const RESTART_TASK_NAME = 'ZSC-Restart';
export const RESTART_DEADLINE_MIN = 15;
export const RESTART_DEADLINE_MAX = 1440;
export const RESTART_DEFER_MIN = 15;
export const RESTART_DEFER_MAX = 480;
export const RESTART_MAX_DEFERRALS = 5;
// Text im Dialog: Buchstaben, Ziffern, Satzzeichen; kein Backtick, kein Dollar, keine doppelten Anfuehrungszeichen
const RESTART_MESSAGE_PATTERN = /^[\p{L}\p{N} .,;:()!?+&%\/'#-]{5,300}$/u;

export interface RestartPromptInput {
  deadlineMinutes: number;
  maxDeferrals: number;
  deferMinutes: number;
  message: string;
}

export function renderRestartPrompt(input: RestartPromptInput): RenderedTemplate & { deadlineMinutes: number; maxDeferrals: number; deferMinutes: number; message: string } {
  const { deadlineMinutes, maxDeferrals, deferMinutes } = input;
  if (!Number.isInteger(deadlineMinutes) || deadlineMinutes < RESTART_DEADLINE_MIN || deadlineMinutes > RESTART_DEADLINE_MAX) throw new Error(`Frist muss zwischen ${RESTART_DEADLINE_MIN} und ${RESTART_DEADLINE_MAX} Minuten liegen`);
  if (!Number.isInteger(maxDeferrals) || maxDeferrals < 0 || maxDeferrals > RESTART_MAX_DEFERRALS) throw new Error(`Verschiebungen muessen zwischen 0 und ${RESTART_MAX_DEFERRALS} liegen`);
  if (!Number.isInteger(deferMinutes) || deferMinutes < RESTART_DEFER_MIN || deferMinutes > RESTART_DEFER_MAX) throw new Error(`Minuten je Verschiebung muessen zwischen ${RESTART_DEFER_MIN} und ${RESTART_DEFER_MAX} liegen`);
  const message = input.message.trim().replace(/\s+/g, ' ');
  if (!RESTART_MESSAGE_PATTERN.test(message) || /[`$"\\]/.test(message)) throw new Error('Text fuer den Benutzer ungueltig: 5 bis 300 Zeichen, keine Anfuehrungszeichen, Backticks oder Dollarzeichen');
  const content = readTemplate('restart-prompt')
    .replace('__DEADLINE_MINUTES__', String(deadlineMinutes))
    .replace('__MAX_DEFERRALS__', String(maxDeferrals))
    .replace('__DEFER_MINUTES__', String(deferMinutes))
    .replace('__MESSAGE__', message.replace(/'/g, "''"))
    .replace('__TASKNAME__', RESTART_TASK_NAME);
  return { id: 'restart-prompt', content, hash: createHash('sha256').update(content).digest('hex'), deadlineMinutes, maxDeferrals, deferMinutes, message };
}

export function renderRestartCancel(): RenderedTemplate {
  const content = readTemplate('restart-cancel').replace('__TASKNAME__', RESTART_TASK_NAME);
  return { id: 'restart-cancel', content, hash: createHash('sha256').update(content).digest('hex') };
}
