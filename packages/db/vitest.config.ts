import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// packages/db owns its own database configuration. Reaching into apps/server for it
// would point a package at an app, which is the coupling direction ARCHITECTURE.md
// rules out.
config({ path: './.env' });

export default defineConfig({
  test: {
    // A connection, a transaction and a rollback per test is slower than a unit test.
    testTimeout: 15_000,
  },
});
