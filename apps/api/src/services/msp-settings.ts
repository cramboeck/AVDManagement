/**
 * Sicherheitseinstellungen je MSP (Vier-Augen-Prinzip u. a.)
 */

import { eq } from 'drizzle-orm';
import { normalizeMspSettings } from '@zerostress/core';
import type { MspSettings } from '@zerostress/types';
import { db, mspOrganizations } from '../db/index.js';

const cache = new Map<string, { value: MspSettings; at: number }>();
const TTL_MS = 60 * 1000;

export async function getMspSettings(mspId: string): Promise<MspSettings> {
  const cached = cache.get(mspId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const row = await db.query.mspOrganizations.findFirst({ where: eq(mspOrganizations.id, mspId), columns: { settings: true } });
  const value = normalizeMspSettings(row?.settings ?? null);
  cache.set(mspId, { value, at: Date.now() });
  return value;
}

export async function updateMspSettings(mspId: string, input: unknown): Promise<MspSettings> {
  const value = normalizeMspSettings(input);
  await db.update(mspOrganizations).set({ settings: value }).where(eq(mspOrganizations.id, mspId));
  cache.set(mspId, { value, at: Date.now() });
  return value;
}
