import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@mxwatch/types': resolve(root, 'packages/types/src/index.ts'),
      '@mxwatch/monitor': resolve(root, 'packages/monitor/src/index.ts'),
      '@mxwatch/monitor/stalwart-parser': resolve(root, 'packages/monitor/src/stalwart-parser.ts'),
      '@mxwatch/alerts': resolve(root, 'packages/alerts/src/index.ts'),
      '@mxwatch/alerts/crypto': resolve(root, 'packages/alerts/src/crypto.ts'),
      '@mxwatch/db': resolve(root, 'packages/db/src/index.ts'),
      '@mxwatch/db/schema': resolve(root, 'packages/db/src/schema.ts'),
      '@': resolve(root, 'apps/web/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
