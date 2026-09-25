import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: './.env' });

// Migrations run as a privileged role, not as the app. pgvector is not a trusted
// extension, so CREATE EXTENSION needs superuser, while the app's own role is
// deliberately not one: superusers bypass row-level security, which would make F012's
// tenant policies look like they work while enforcing nothing.
// No fallback to the app's DATABASE_URL. That role is deliberately not a superuser, so
// falling back to it would fail on CREATE EXTENSION with an error drizzle-kit swallows
// entirely: a spinner, exit code 1, and no message.
const databaseUrl = process.env.MIGRATION_DATABASE_URL;

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error(
    'MIGRATION_DATABASE_URL is not set. Copy packages/db/.env.example to .env first.',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  // Keeps generated SQL readable in review, which CLAUDE.md treats a migration as.
  verbose: true,
  strict: true,
});
