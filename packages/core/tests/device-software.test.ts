/**
 * Tests: Zuordnung der Software eines Geraets zu winget und Katalog (Backend)
 */

import { describe, it, expect } from 'vitest';
import { matchDeviceSoftware, matchInventoryId, matchWingetUpdate, wingetInventoryFromOutput, wingetUpdatesFromOutput } from '../src/apps/device-software.js';
import type { SoftwareBlockRule, WingetCatalogEntry } from '@zerostress/types';

const baseSet = [
  { id: 'Logitech.OptionsPlus', name: 'Logi Options+', aliases: ['Logitech Options+'], kind: 'app' },
  { id: 'Logitech.Options', name: 'Logitech Options', kind: 'app' },
  { id: 'Git.Git', name: 'Git', kind: 'app' },
] as unknown as WingetCatalogEntry[];

const ctx = (over: Partial<Parameters<typeof matchDeviceSoftware>[1]> = {}) => ({ updates: [], inventoryIds: [], packages: [], baseSet, rules: [] as SoftwareBlockRule[], ...over });

describe('device software matching', () => {
  it('keeps Options+ and Options apart (longest catalog name wins)', () => {
    expect(matchDeviceSoftware({ displayName: 'Logitech Options+' }, ctx()).catalog?.id).toBe('Logitech.OptionsPlus');
    expect(matchDeviceSoftware({ displayName: 'Logitech Options' }, ctx()).catalog?.id).toBe('Logitech.Options');
  });

  it('does not match short names inside other words', () => {
    expect(matchDeviceSoftware({ displayName: 'Logitech Unifying' }, ctx()).catalog).toBeNull();
    expect(matchDeviceSoftware({ displayName: 'Git version 2.47' }, ctx()).catalog?.id).toBe('Git.Git');
  });

  it('marks an available update and takes its winget id', () => {
    const updates = wingetUpdatesFromOutput({ schema: 'zsc.winget-updates/1', updates: [{ name: '7-Zip 24.07 (x64)', id: '7zip.7zip', installed: '24.07', available: '24.09' }] });
    expect(matchWingetUpdate('7-Zip 24.07 (x64)', updates)?.available).toBe('24.09');
    const m = matchDeviceSoftware({ displayName: '7-Zip 24.07 (x64)' }, ctx({ updates }));
    expect(m).toMatchObject({ wingetState: 'update', wingetId: '7zip.7zip' });
  });

  it('falls back to the winget inventory for the id', () => {
    const { ids } = wingetInventoryFromOutput({ schema: 'zsc.winget-inventory/1', ids: 'Notepad++.Notepad++;Mozilla.Firefox' });
    expect(matchInventoryId('Mozilla Firefox (x64 de)', ids)).toBe('Mozilla.Firefox');
    expect(matchDeviceSoftware({ displayName: 'Mozilla Firefox (x64 de)' }, ctx({ inventoryIds: ids })).wingetState).toBe('catalog');
  });

  it('reports a block rule by winget id or name', () => {
    const rules = [{ id: 'r1', kind: 'name', pattern: 'teamviewer', note: null, createdByEmail: 'x', createdAt: 'x' }] as SoftwareBlockRule[];
    expect(matchDeviceSoftware({ displayName: 'TeamViewer 15' }, ctx({ rules })).blockedBy).toBe('teamviewer');
  });

  it('ignores outputs of other scripts', () => {
    expect(wingetUpdatesFromOutput({ schema: 'zsc.monitor/1' })).toEqual([]);
    expect(wingetInventoryFromOutput(null)).toEqual({ ids: [], truncated: false });
  });
});
