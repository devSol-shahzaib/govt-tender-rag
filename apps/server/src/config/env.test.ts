import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfig } from './env.js';

const validEnv = { CLIENT_ORIGIN: 'http://localhost:3000' };

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
