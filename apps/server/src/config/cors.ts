import type { CorsOptions } from 'cors';
import { getConfig } from './env.js';

/**
 * The client is served from a different origin than the API (D011), so every browser
 * request is cross-origin and preflighted. The allowed origin is configuration rather
 * than a wildcard because credentials cannot be sent to a wildcard origin, and the
 * chat UI will need cookies once auth arrives in F012.
 */
export function getCorsOptions(): CorsOptions {
  const { CLIENT_ORIGIN } = getConfig();

  return {
    origin: CLIENT_ORIGIN,
    credentials: true,
  };
}
