import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

/**
 * The client does not use the shared baseConfig. That base turns on type-aware
 * linting through typescript-eslint's project service, which conflicts with the
 * parser setup eslint-config-next installs. Next's own config is not type-aware, so
 * the rules CLAUDE.md requires are restated here rather than inherited.
 *
 * Worth revisiting in F010, when there is enough client code for type-aware rules to
 * earn the extra configuration.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  // Must stay last: switches off every rule that would fight Prettier.
  prettier,
]);
