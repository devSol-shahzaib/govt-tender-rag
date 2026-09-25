import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromHere = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests read workspace packages from source, so a stale dist can never make a test
    // pass or fail for the wrong reason, and no build is needed before running them.
    // Production still resolves through each package's exports field to dist (D017).
    alias: {
      '@tender/core': fromHere('../../packages/core/src/index.ts'),
      '@tender/db': fromHere('../../packages/db/src/index.ts'),
    },
  },
  test: {
    // The logger reads LOG_LEVEL when the module is first imported, so it has to be
    // set before any test imports the app. Silencing it keeps test output readable.
    env: { LOG_LEVEL: 'silent' },
  },
});
