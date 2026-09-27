/**
 * Tests fuer das Vier-Augen-Prinzip: Einstellungen und Entscheidung
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_MSP_SETTINGS, affectedObjects, evaluateFourEyes, normalizeMspSettings } from '../src/jobs/approval-policy.js';

const change = { objectType: 'device', objectId: 'x', objectDisplayName: 'x', action: 'update' as const, before: {}, after: {} };

describe('normalizeMspSettings', () => {
  it('applies defaults and drops invalid values', () => {
    expect(normalizeMspSettings(null)).toEqual(DEFAULT_MSP_SETTINGS);
    expect(normalizeMspSettings({ fourEyes: { enabled: true, minObjects: -1, jobTypes: ['vm.deploy', 'not valid!'] } }).fourEyes).toEqual({ enabled: true, minObjects: 10, jobTypes: ['vm.deploy'] });
    expect(normalizeMspSettings({ fourEyes: { enabled: 'yes' } }).fourEyes.enabled).toBe(false);
  });
});

describe('evaluateFourEyes', () => {
  const on = { ...DEFAULT_MSP_SETTINGS, fourEyes: { enabled: true, minObjects: 5, jobTypes: ['vm.deploy'] } };

  it('is off by default', () => {
    expect(evaluateFourEyes(DEFAULT_MSP_SETTINGS, { type: 'vm.deploy', payload: {} }, { changes: [] })).toEqual({ required: false, reason: null });
  });

  it('requires a second approval for listed types and for large batches', () => {
    expect(evaluateFourEyes(on, { type: 'vm.deploy', payload: {} }, { changes: [change] }).required).toBe(true);
    expect(evaluateFourEyes(on, { type: 'group.add-member', payload: {} }, { changes: [change] }).required).toBe(false);
    expect(evaluateFourEyes(on, { type: 'device.winget-bulk', payload: { devices: Array(5).fill({}) } }, { changes: Array(5).fill(change) })).toMatchObject({ required: true, reason: '5 betroffene Objekte (Schwelle 5)' });
    expect(evaluateFourEyes(on, { type: 'apps.publish', payload: { batchSize: 7 } }, { changes: [change] }).required).toBe(true);
    expect(evaluateFourEyes({ fourEyes: { ...on.fourEyes, minObjects: 0 } }, { type: 'apps.publish', payload: { batchSize: 70 } }, { changes: [change] }).required).toBe(false);
  });

  it('counts the largest of preview rows, devices, tenants and batch size', () => {
    expect(affectedObjects({ payload: { tenantIds: ['a', 'b', 'c'] } }, { changes: [change] })).toBe(3);
    expect(affectedObjects({ payload: { batchSize: 'x' } }, { changes: [change, change] })).toBe(2);
  });
});
