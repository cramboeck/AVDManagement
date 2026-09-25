import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Tests laufen wie der Dev-Modus gegen die Quellen der Workspace-Pakete
export default defineConfig({
  resolve: {
    alias: {
      '@zerostress/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@zerostress/types': fileURLToPath(new URL('../../packages/types/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
