/**
 * Vorlagenkatalog fuer Azure-Bereitstellungen
 *
 * ARM-Vorlagen liegen versioniert unter packages/core/templates/azure und
 * sind die einzige Quelle: keine Vorlagen aus der Datenbank, kein Freitext.
 * Der Katalog liest die Parameterdefinitionen aus der Vorlage, prueft
 * Eingaben dagegen und liefert die Parameter im ARM-Format. Sichere
 * Parameter (adminPassword) setzt das Cockpit selbst.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { VmTemplateParameter, VmTemplateSummary } from '@zerostress/types';

interface RawParameter {
  type: string;
  defaultValue?: unknown;
  allowedValues?: unknown[];
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  metadata?: { description?: string };
}

interface RawTemplate {
  metadata?: { zsc?: { id?: string; displayName?: string; description?: string; version?: string; osType?: string } };
  parameters?: Record<string, RawParameter>;
  resources?: Array<{ type?: string }>;
}

export interface LoadedTemplate extends VmTemplateSummary {
  template: Record<string, unknown>;
  raw: RawTemplate;
}

const MANAGED_PARAMETERS = new Set(['adminPassword']);
const VM_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,14}$/;
const VM_SIZE = /^[A-Za-z0-9_]{3,40}$/;
const SUBNET_ID = /^\/subscriptions\/[0-9a-fA-F-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Network\/virtualNetworks\/[^/]+\/subnets\/[^/]+$/;
const TAG_KEY = /^[A-Za-z0-9 _.-]{1,64}$/;

let cache: LoadedTemplate[] | null = null;

function toParameter(name: string, raw: RawParameter): VmTemplateParameter {
  const type = (['string', 'int', 'bool', 'securestring', 'object'] as const).find((t) => t === raw.type.toLowerCase());
  return {
    name,
    type: type ?? 'string',
    description: raw.metadata?.description ?? '',
    defaultValue: raw.defaultValue ?? null,
    allowedValues: raw.allowedValues ?? null,
    managed: MANAGED_PARAMETERS.has(name) || raw.type.toLowerCase() === 'securestring',
  };
}

export function loadVmTemplates(): LoadedTemplate[] {
  if (cache) return cache;
  const dir = new URL('../../templates/azure/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  cache = files.map((file) => {
    const content = readFileSync(new URL(file, dir), 'utf8');
    const raw = JSON.parse(content) as RawTemplate;
    const meta = raw.metadata?.zsc ?? {};
    const id = meta.id ?? file.replace(/\.json$/, '');
    if (!/^[a-z0-9-]{3,40}$/.test(id)) throw new Error(`Template id invalid in ${file}`);
    const template = JSON.parse(content) as Record<string, unknown>;
    return {
      id,
      displayName: meta.displayName ?? id,
      description: meta.description ?? '',
      version: meta.version ?? '0.0.0',
      osType: meta.osType === 'Linux' ? 'Linux' : 'Windows',
      parameters: Object.entries(raw.parameters ?? {}).map(([name, p]) => toParameter(name, p)),
      resources: Array.from(new Set((raw.resources ?? []).map((r) => r.type ?? '').filter(Boolean))),
      hash: createHash('sha256').update(content).digest('hex'),
      template,
      raw,
    };
  });
  return cache;
}

export function getVmTemplate(id: string): LoadedTemplate | null {
  return loadVmTemplates().find((t) => t.id === id) ?? null;
}

export function toTemplateSummary(t: LoadedTemplate): VmTemplateSummary {
  const { template: _t, raw: _r, ...summary } = t;
  return summary;
}

export class TemplateInputError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}

/**
 * Nutzereingaben gegen die Vorlage pruefen. Rueckgabe: Parameter im
 * ARM-Format ({ name: { value } }) ohne die verwalteten Parameter.
 */
export function buildTemplateParameters(t: LoadedTemplate, input: Record<string, unknown>): Record<string, { value: unknown }> {
  const problems: string[] = [];
  const out: Record<string, { value: unknown }> = {};
  for (const [name, raw] of Object.entries(t.raw.parameters ?? {})) {
    if (MANAGED_PARAMETERS.has(name) || raw.type.toLowerCase() === 'securestring') continue;
    const provided = input[name];
    const value = provided === undefined || provided === null || provided === '' ? raw.defaultValue : provided;
    if (value === undefined) {
      problems.push(`${name} fehlt`);
      continue;
    }
    const type = raw.type.toLowerCase();
    if (type === 'string') {
      if (typeof value !== 'string') {
        problems.push(`${name} muss Text sein`);
        continue;
      }
      if (raw.minLength !== undefined && value.length < raw.minLength) problems.push(`${name} zu kurz`);
      if (raw.maxLength !== undefined && value.length > raw.maxLength) problems.push(`${name} zu lang`);
      if (raw.allowedValues && !raw.allowedValues.includes(value)) problems.push(`${name} muss einer von ${raw.allowedValues.join(', ')} sein`);
      if (name === 'vmName' && !VM_NAME.test(value)) problems.push('vmName: 1-15 Zeichen, Buchstaben, Ziffern, Bindestrich, nicht mit Bindestrich beginnen');
      if (name === 'vmSize' && !VM_SIZE.test(value)) problems.push('vmSize ungueltig');
      if (name === 'subnetId' && !SUBNET_ID.test(value)) problems.push('subnetId muss eine Subnetz-Ressourcen-Id sein');
      if (name === 'adminUsername' && !/^[A-Za-z][A-Za-z0-9_-]{2,19}$/.test(value)) problems.push('adminUsername: 3-20 Zeichen, mit Buchstabe beginnen');
      if (name === 'adminUsername' && /^(administrator|admin|root|guest|user)$/i.test(value)) problems.push('adminUsername darf kein reservierter Name sein');
      out[name] = { value };
    } else if (type === 'int') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(n)) {
        problems.push(`${name} muss eine ganze Zahl sein`);
        continue;
      }
      if (raw.minValue !== undefined && n < raw.minValue) problems.push(`${name} mindestens ${raw.minValue}`);
      if (raw.maxValue !== undefined && n > raw.maxValue) problems.push(`${name} hoechstens ${raw.maxValue}`);
      if (raw.allowedValues && !raw.allowedValues.includes(n)) problems.push(`${name} muss einer von ${raw.allowedValues.join(', ')} sein`);
      out[name] = { value: n };
    } else if (type === 'bool') {
      out[name] = { value: value === true || value === 'true' };
    } else if (type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value)) {
        problems.push(`${name} muss ein Objekt sein`);
        continue;
      }
      if (name === 'tags') {
        const tags: Record<string, string> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (!TAG_KEY.test(k) || typeof v !== 'string' || v.length > 256) {
            problems.push(`Tag ${k} ungueltig`);
            continue;
          }
          tags[k] = v;
        }
        out[name] = { value: tags };
      } else {
        out[name] = { value };
      }
    } else {
      problems.push(`${name}: Typ ${raw.type} nicht unterstuetzt`);
    }
  }
  for (const key of Object.keys(input)) {
    if (!(key in (t.raw.parameters ?? {}))) problems.push(`Unbekannter Parameter ${key}`);
  }
  if (problems.length > 0) throw new TemplateInputError(problems);
  return out;
}

/** Namen der Parameter, die das Cockpit selbst befuellt (Passwort). */
export function managedParameterNames(t: LoadedTemplate): string[] {
  return Object.entries(t.raw.parameters ?? {})
    .filter(([name, raw]) => MANAGED_PARAMETERS.has(name) || raw.type.toLowerCase() === 'securestring')
    .map(([name]) => name);
}
