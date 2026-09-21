import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { getCorsOptions } from './config/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createRequestLogger } from './middleware/requestLogger.js';
import { healthRouter } from './modules/health/health.routes.js';

export function createApp(): express.Application {
  const app = express();

  app.use(createRequestLogger());
  app.use(helmet());
  app.use(cors(getCorsOptions()));
  // Tender questions are short. A low cap keeps a malformed or hostile body from
  // being buffered before anything looks at it.
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
