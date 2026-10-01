export { databaseUrlSchema, redactDatabaseUrl } from './config/database-url.js';
export { createDatabase, type Database } from './client.js';
export * from './schema/index.js';

// Re-exported so consumers do not take a direct dependency on drizzle-orm. The ORM
// stays an implementation detail of this package, which is the one that owns
// persistence. Add operators here as they are actually needed.
export { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
