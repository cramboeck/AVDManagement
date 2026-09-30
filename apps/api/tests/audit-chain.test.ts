/**
 * Tests fuer die Hash-Kette des Audit-Logs
 */

import { describe, it, expect } from 'vitest';
import { canonical, computeEntryHash, GENESIS_HASH } from '../src/services/audit-chain.js';

const fields = {
  mspId: 'm1',
  tenantId: null,
  timestamp: '2026-09-30T10:00:00.000Z',
  userId: 'u1',
  action: 'job.approve',
  targetType: 'job',
  targetId: 'j1',
  targetDisplayName: 'Test',
  beforeState: { b: 1, a: [1, { z: true, y: null }] },
  afterState: null,
  result: 'success',
  errorMessage: null,
  correlationId: 'c1',
};

describe('audit chain', () => {
  it('serialises canonically regardless of key order and undefined values', () => {
    expect(canonical({ b: 1, a: 2, c: undefined })).toBe('{"a":2,"b":1}');
    expect(canonical({ a: 2, b: 1 })).toBe(canonical({ b: 1, a: 2 }));
    expect(canonical([1, 'x', null])).toBe('[1,"x",null]');
  });

  it('changes the hash when any field or the predecessor changes', () => {
    const h = computeEntryHash(GENESIS_HASH, fields);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEntryHash(GENESIS_HASH, { ...fields, result: 'failure' })).not.toBe(h);
    expect(computeEntryHash(GENESIS_HASH, { ...fields, beforeState: { b: 1, a: [1, { z: true, y: null }] } })).toBe(h);
    expect(computeEntryHash(h, fields)).not.toBe(h);
  });
});
