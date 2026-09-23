import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { getConfig } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Attaches a per-request child logger and a request id.
 *
 * The id is echoed on 500 responses so a user can quote it, and Module 1's tracing
 * will hang spans off the same value.
 */
export function createRequestLogger() {
  const { LOG_CLIENT_IP } = getConfig();

  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = req.headers['x-request-id'];
      const id = typeof existing === 'string' && existing !== '' ? existing : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // The default serializer logs the full request including the client address.
    // IP addresses are personal data, so they are opt-in.
    serializers: {
      req: (req: { method: string; url: string; remoteAddress?: string }) => ({
        method: req.method,
        url: req.url,
        ...(LOG_CLIENT_IP ? { remoteAddress: req.remoteAddress } : {}),
      }),
      // The default serializer logs every response header, which buries the useful
      // fields and would start emitting set-cookie once auth lands in F012.
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
