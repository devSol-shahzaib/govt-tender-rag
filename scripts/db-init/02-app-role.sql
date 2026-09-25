-- Local development only.
--
-- Two roles exist here because pgvector is not a trusted extension: installing it
-- needs a superuser, while the app must NOT be one, since superusers bypass
-- row-level security and would make F012's tenant policies look like they work.
--
-- Migrations therefore run as `tender` and own the tables, so the app role needs
-- explicit privileges on them. A managed host like Neon gives one role that both owns
-- and queries, so none of this applies there.
--
-- Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tender_app') THEN
    CREATE ROLE tender_app LOGIN PASSWORD 'app_l0cal_7Kq2' NOSUPERUSER;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO tender_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tender_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tender_app;

-- Covers tables future migrations create, so this does not need re-running each time.
ALTER DEFAULT PRIVILEGES FOR ROLE tender IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tender_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tender IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tender_app;
