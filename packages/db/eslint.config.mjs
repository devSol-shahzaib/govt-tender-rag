import { baseConfig } from '../../eslint.base.mjs';

export default [{ ignores: ['dist/**'] }, ...baseConfig(import.meta.dirname)];
