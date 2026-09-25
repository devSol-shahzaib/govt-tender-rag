-- Creates the unprivileged application role and the grants it needs.
--
-- Two roles exist because pgvector is not a trusted extension: installing it needs a
-- superuser, while the app must not be one, since superusers bypass row-level security
-- and would make F012's tenant policies look like they work (D018). Migrations
-- therefore own the tables, so the app role needs explicit privileges on them. A
-- managed host that gives one role for both owning and querying needs none of this.
--
-- Takes the password as a variable so no credential is committed:
--   psql -U tender -d tender_dev -v app_password=... -f scripts/create-app-role.sql
--
-- Not in db-init/, because scripts there run unattended on first container boot and
-- cannot be given a variable. Safe to re-run.

-- Raised as a SQL exception rather than \quit, which ignores its argument and exits 0.
-- A caller checking the exit code would otherwise treat a missing password as success.
\if :{?app_password}
\else
DO $$ BEGIN
  RAISE EXCEPTION 'app_password is required. Re-run with -v app_password=<password>';
END $$;
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tender_app') THEN
    CREATE ROLE tender_app LOGIN NOSUPERUSER;
  END IF;
END
$$;

-- Set unconditionally, not only on create. Setting it inside the branch above meant an
-- existing role kept whatever password it already had, so the env file drifted away
-- from the database and nothing noticed until the first real connection, four days later.
ALTER ROLE tender_app LOGIN NOSUPERUSER PASSWORD :'app_password';

GRANT USAGE ON SCHEMA public TO tender_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tender_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tender_app;

-- Covers tables future migrations create, so this does not need re-running each time.
ALTER DEFAULT PRIVILEGES FOR ROLE tender IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tender_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tender IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tender_app;
