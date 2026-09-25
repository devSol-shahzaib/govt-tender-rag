import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// DATABASE_URL lives with the server rather than being duplicated here, so there is
// one copy of the credential and no way for the two to drift.
config({ path: '../../apps/server/.env' });

// Migrations run as a privileged role, not as the app. pgvector is not a trusted
// extension, so CREATE EXTENSION needs superuser, while the app's own role is
// deliberately not one: superusers bypass row-level security, which would make F012's
// tenant policies look like they work while enforcing nothing.
const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error(
    'Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set. Copy apps/server/.env.example to .env first.',
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
