import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The logger reads LOG_LEVEL when the module is first imported, so it has to be
    // set before any test imports the app. Silencing it keeps test output readable.
    env: { LOG_LEVEL: 'silent' },
  },
});
