/**
 * Lokaler Artefaktspeicher: Ablage mit Hash, Lesen, Loeschen, unsichere Schluessel
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createLocalArtifactStore, assertSafeKey } from '../src/services/artifact-store.js';

describe('local artifact store', () => {
  it('stores a stream, reports sha256 and size, reads it back and deletes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zsc-artifacts-'));
    try {
      const store = createLocalArtifactStore(root);
      const content = Buffer.from('MSCF fake intunewin content '.repeat(1000));
      const stored = await store.put('packages/abc/artifact/app.intunewin', Readable.from([content]));
      expect(stored.sizeBytes).toBe(content.length);
      expect(stored.sha256).toBe(createHash('sha256').update(content).digest('hex'));

      const chunks: Buffer[] = [];
      for await (const chunk of await store.get('packages/abc/artifact/app.intunewin')) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).equals(content)).toBe(true);

      await store.delete('packages/abc/artifact/app.intunewin');
      await expect(store.get('packages/abc/artifact/app.intunewin')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses keys that could escape the root', () => {
    expect(() => assertSafeKey('../etc/passwd')).toThrow();
    expect(() => assertSafeKey('packages/x/../../y')).toThrow();
    expect(() => assertSafeKey('packages')).toThrow();
    expect(assertSafeKey('packages/abc/installer/setup 1.2 (x64).exe')).toBe('packages/abc/installer/setup 1.2 (x64).exe');
  });
});
