import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfig } from './env.js';

const validEnv = {
  CLIENT_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://tender_app:pw@localhost:5432/tender_dev',
};

beforeEach(() => {
  resetConfig();
});

describe('loadConfig', () => {
  it('applies defaults for everything except the client origin', () => {
    const config = loadConfig(validEnv);

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.LOG_CLIENT_IP).toBe(false);
  });

  it('coerces PORT from the string the environment always provides', () => {
    expect(loadConfig({ ...validEnv, PORT: '4100' }).PORT).toBe(4100);
  });

  it('turns LOG_CLIENT_IP into a boolean rather than the string "true"', () => {
    expect(loadConfig({ ...validEnv, LOG_CLIENT_IP: 'true' }).LOG_CLIENT_IP).toBe(true);
  });

  it('fails when CLIENT_ORIGIN is missing, naming the variable', () => {
    expect(() => loadConfig({})).toThrowError(/CLIENT_ORIGIN/);
  });

  it('applies the connection string rule from @tender/db', () => {
    // Proves the workspace dependency resolves and its schema actually runs here,
    // rather than the server quietly accepting any string.
    expect(() =>
      loadConfig({ ...validEnv, DATABASE_URL: 'mysql://user@host:3306/db' }),
    ).toThrowError(/DATABASE_URL/);
  });

  it('names a bad variable without echoing its value', () => {
    const secretish = 'super-secret-value-that-must-not-leak';

    try {
      loadConfig({ CLIENT_ORIGIN: secretish });
      expect.unreachable('expected loadConfig to throw');
    } catch (error) {
      const message = (error as Error).message;

      expect(message).toContain('CLIENT_ORIGIN');
      expect(message).not.toContain(secretish);
    }
  });

  it('rejects an unknown NODE_ENV instead of passing it through', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrowError(/NODE_ENV/);
  });
});
