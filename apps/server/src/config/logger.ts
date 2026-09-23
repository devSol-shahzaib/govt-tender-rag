import { pino } from 'pino';

/**
 * Reads LOG_LEVEL from the environment directly rather than through getConfig().
 *
 * env.ts needs to log when validation fails, so taking config from there would make
 * the two modules import each other. A bad LOG_LEVEL falls back to info instead of
 * failing, because losing logs is worse than running at the wrong verbosity.
 */
const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

const level =
  process.env.LOG_LEVEL !== undefined && LEVELS.includes(process.env.LOG_LEVEL)
    ? process.env.LOG_LEVEL
    : 'info';

export const logger = pino({
  level,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.apiKey'],
    censor: '***',
  },
});
