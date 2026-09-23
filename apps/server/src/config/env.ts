import { databaseUrlSchema } from '@tender/db';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // 4000, not 5000: macOS binds 5000 to AirPlay Receiver, which fails in a way that
  // looks like the server crashed rather than like a port clash.
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Required, with no default. CORS is the whole reason the client and server can
  // talk at all (D011), and guessing an origin here would fail at request time in the
  // browser instead of at startup where it is obvious.
  CLIENT_ORIGIN: z.url(),
  // Reuses the rule from packages/db rather than restating it, so the server, the
  // migration tooling and the Module 2 eval runner cannot disagree about what a valid
  // connection string is.
  DATABASE_URL: databaseUrlSchema,
  // IP addresses are personal data, so request logs omit them by default. Enable
  // temporarily when investigating abuse.
  LOG_CLIENT_IP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

let config: Env | undefined;

/**
 * Parses and caches the environment.
 *
 * Reports the names of variables that failed and the rule each one broke, never the
 * value: most entries in this schema are secrets or become secrets later, and a
 * validation error is exactly the moment a mistyped one would be echoed into logs.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const invalid = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${invalid}`);
  }

  config = parsed.data;
  return config;
}

export function getConfig(): Env {
  return config ?? loadConfig();
}

/** Test helper. Clears the cache so a test can load a different environment. */
export function resetConfig(): void {
  config = undefined;
}
