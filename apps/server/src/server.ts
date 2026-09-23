import type { Server } from 'node:http';
import 'dotenv/config';
import { createApp } from './app.js';
import { logger } from './config/logger.js';
import { loadConfig } from './config/env.js';

function registerShutdown(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    // A second Ctrl-C should not start a second teardown.
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    // Nothing should be able to hang the exit indefinitely.
    const force = setTimeout(() => {
      logger.warn('Shutdown timed out, exiting anyway');
      process.exit(1);
    }, 5000);
    force.unref();

    // close() alone waits for open connections, and browsers hold keep-alive sockets
    // open for a minute or more, so the old process can outlive a `tsx watch` restart
    // and the replacement finds the port taken.
    server.closeAllConnections();
    server.close(() => {
      clearTimeout(force);
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function startServer(): void {
  let port: number;

  try {
    port = loadConfig().PORT;
  } catch (error) {
    // Logged here rather than thrown to the top level so the operator sees a sentence
    // naming the bad variable instead of a stack trace.
    logger.fatal({ err: error }, 'Invalid environment configuration');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(port, () => {
    logger.info({ port, env: process.env.NODE_ENV }, 'Server listening');
  });

  // listen() reports failures by emitting on the server rather than throwing, so a
  // try/catch around it never sees them.
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(
        { port },
        `Port ${port} is already in use. Another instance is probably still running, ` +
          `or set PORT to something else.`,
      );
    } else {
      logger.error({ err: error }, 'Server failed to start');
    }
    process.exit(1);
  });

  registerShutdown(server);
}

startServer();
