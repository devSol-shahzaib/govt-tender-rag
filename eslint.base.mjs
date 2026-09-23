import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Shared rules for every workspace package.
 *
 * Each package owns its own `eslint.config.mjs` and calls this, because the client
 * needs React and Next rules that must not reach server code. `tsconfigRootDir` is
 * passed in rather than derived here: type-aware linting resolves each package's own
 * tsconfig, and deriving it from this file would point every package at the root.
 */
export function baseConfig(tsconfigRootDir) {
  return tseslint.config(
    js.configs.recommended,

    // Type-aware rules. These are what catch an unawaited promise in the ingestion
    // pipeline, where the failure is a silently missing page rather than a crash.
    ...tseslint.configs.recommendedTypeChecked,
    {
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: {
        parserOptions: {
          // Config files sit outside each package's tsconfig `include`, which is
          // scoped to src. Without this they have no type information and the parser
          // refuses them.
          projectService: { allowDefaultProject: ['*.config.ts'] },
          tsconfigRootDir,
        },
      },
      rules: {
        // CLAUDE.md forbids both outright, so they are errors rather than warnings.
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        // Express identifies error handlers by arity, so unused-but-required
        // parameters are a fact of the framework. The underscore marks intent.
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
        'no-console': 'warn',
      },
    },

    // Config and tooling files in a package are plain JS outside its tsconfig, so
    // type-aware rules cannot run on them and error out if they are left enabled.
    {
      files: ['**/*.js', '**/*.mjs'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: { ...globals.node } },
    },

    // Must stay last: switches off every rule that would fight Prettier.
    prettier,
  );
}
