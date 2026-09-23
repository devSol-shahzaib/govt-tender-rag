import { z } from 'zod';

const POSTGRES_PROTOCOLS = ['postgres:', 'postgresql:'];

/**
 * A Postgres connection string.
 *
 * This lives in the db package rather than in the server's env schema because the
 * rule for what a valid connection looks like belongs with the database code. The
 * eval runner (Module 2) and migration tooling need the same rule without importing
 * anything from the server.
 */
export const databaseUrlSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a valid URL' });
      return;
    }

    if (!POSTGRES_PROTOCOLS.includes(url.protocol)) {
      ctx.addIssue({
        code: 'custom',
        message: `must use postgres:// or postgresql://, got ${url.protocol}//`,
      });
    }

    // `new URL('postgresql://host')` parses happily with an empty pathname, and the
    // resulting connection silently falls back to a database named after the user.
    // Requiring it here turns that into a startup failure instead of queries running
    // against the wrong database.
    if (url.pathname.replace('/', '').length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must include a database name' });
    }
  });

/**
 * Replaces the password with a fixed marker so a connection string can be logged.
 *
 * Returns the marker alone for input that does not parse, because the caller is on a
 * logging path and a malformed string must not be echoed in full: it is exactly the
 * case where the value is most likely to be a mistyped secret.
 */
export function redactDatabaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return '[unparseable database url]';
  }

  if (url.password === '') {
    return url.toString();
  }

  url.password = '***';
  return url.toString();
}
