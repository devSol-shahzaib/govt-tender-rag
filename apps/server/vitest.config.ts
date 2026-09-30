import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Integration tests need TEST_DATABASE_URL. Loaded here so it is set before any test
// module is imported.
config({ path: './.env' });

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
    // Integration tests parse real PDFs and write to a real database. The slowest take
    // about 2s under normal load, and one failed under the default 5s limit when run
    // straight after a full build. Matches the limit packages/db already uses.
    testTimeout: 15_000,
    // The logger reads LOG_LEVEL when the module is first imported, so it has to be
    // set before any test imports the app. Silencing it keeps test output readable.
    env: { LOG_LEVEL: 'silent' },
  },
});
