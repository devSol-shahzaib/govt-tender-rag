import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>['db'];

/**
 * Opens a connection and returns the Drizzle handle with the schema attached.
 *
 * The caller owns closing it. Side effects stay at the edges, so nothing in this
 * package opens a connection as a side effect of being imported.
 */
export function createDatabase(connectionString: string, options: { max?: number } = {}) {
  const client = postgres(connectionString, { max: options.max ?? 10 });
  const db = drizzle(client, { schema });

  return { db, client, close: async () => client.end() };
}
