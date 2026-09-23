import { describe, expect, it } from 'vitest';
import { databaseUrlSchema, redactDatabaseUrl } from './database-url.js';

const LOCAL_URL = 'postgresql://tender_app:not-a-real-password@localhost:5432/tender_dev';

describe('databaseUrlSchema', () => {
  it('accepts the local development connection string', () => {
    expect(databaseUrlSchema.parse(LOCAL_URL)).toBe(LOCAL_URL);
  });

  it('accepts the postgres:// spelling as well as postgresql://', () => {
    expect(() => databaseUrlSchema.parse('postgres://user@host:5432/db')).not.toThrow();
  });

  it('rejects a non-postgres protocol', () => {
    const result = databaseUrlSchema.safeParse('mysql://user@host:3306/db');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/postgres/);
  });

  it('rejects a connection string with no database name', () => {
    const result = databaseUrlSchema.safeParse('postgresql://user@localhost:5432');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/database name/);
  });

  it('rejects a string that is not a URL at all', () => {
    expect(databaseUrlSchema.safeParse('not-a-url').success).toBe(false);
  });
});

describe('redactDatabaseUrl', () => {
  it('removes the password so the string can be logged', () => {
    const redacted = redactDatabaseUrl(LOCAL_URL);

    expect(redacted).not.toContain('not-a-real-password');
    expect(redacted).toContain('tender_app');
    expect(redacted).toContain('tender_dev');
  });

  it('leaves a connection string without a password unchanged', () => {
    const url = 'postgresql://tender_app@localhost:5432/tender_dev';

    expect(redactDatabaseUrl(url)).toBe(url);
  });

  it('never echoes input it cannot parse', () => {
    expect(redactDatabaseUrl('postgres://[malformed')).toBe('[unparseable database url]');
  });
});
