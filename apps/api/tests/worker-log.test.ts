/**
 * Tests fuer das Zusammenfuehren von Worker-Protokollen
 */

import { describe, it, expect } from 'vitest';
import { mergeWorkerLogs } from '../src/services/worker-log.js';

describe('mergeWorkerLogs', () => {
  it('keeps streamed lines once and appends only new lines from the final log', () => {
    const streamed = '[2026-09-27T15:00:24.787Z] Build abc\n[2026-09-27T15:00:25.769Z] Installer hash verified';
    const final = '[2026-09-27 17:00:24] [INFO] Build abc\n[2026-09-27 17:00:25] [INFO] Installer hash verified\n[2026-09-27 17:00:32] [INFO] Artifact uploaded and verified';
    expect(mergeWorkerLogs(streamed, final, 10_000)).toBe(`${streamed}\n[2026-09-27 17:00:32] [INFO] Artifact uploaded and verified`);
  });

  it('handles empty inputs and the length limit', () => {
    expect(mergeWorkerLogs(null, null, 100)).toBeNull();
    expect(mergeWorkerLogs(null, 'only final', 100)).toBe('only final');
    expect(mergeWorkerLogs('x'.repeat(50), null, 10)).toBe('x'.repeat(10));
  });
});
