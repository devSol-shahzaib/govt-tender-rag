# F002: Database schema and pgvector setup

**Status:** Approved
**Module:** 0
**Branch:** feat/002-db-schema

## Goal
Drizzle schema and migrations for the tender domain, applied by one path that works identically on the local container, in CI and on Neon.

## Two findings from the manifest that shape this feature

`kphealth_antimalaria-2025-26` contains a document labelled `revised` dated 16-January-2026 and one labelled `original` dated 06-February-2026. The revised document is genuinely the older one. So `doc_type` and `version` cannot order documents, and `version` is free text with eleven inconsistent values. Only `date_on_listing` orders them, and every row has one. D004 therefore resolves amendments by date alone.

`epads/bidding-document.pdf` is a byte-identical copy of `ngc_p96607` and has no `tender_id`. Importing both would chunk the same passage twice, which looks like corroboration in retrieval but is one source counted double. The database rejects this through a unique content hash rather than trusting a convention.

## Scope
- `drizzle-orm` and `drizzle-kit` in `packages/db`, config reading `DATABASE_URL`
- Migration `0000` creates the extensions `vector` and `pg_trgm`, so one path covers local, CI and Neon. The Docker init script stays as a local convenience only
- Tables: `tenants`, `tenders`, `documents`, `pages`, `chunks`
- `tenant_id` not null on every table, with one seeded default tenant
- `documents.content_sha256`, unique per tenant
- `documents.published_on`, the sole amendment ordering key
- `pages.page_number`, 1-based physical, with a check constraint
- drizzle-zod compatibility check, deferred here from F001
- Postgres service container in the CI workflow

## Out of scope
- Embedding column and vector index. F006, once the model and dimension are chosen by measurement
- `tsvector` column and full-text indexes. F008
- Row-level security policies. F012. The `tenant_id` columns land now, the enforcement does not
- Importing `sources.csv`. F003
- Page text extraction and OCR. F004

## Approach
`doc_type` is a Postgres enum over the six known values. `version` is stored as the manifest's free text for provenance but is never used for ordering, with a comment citing the antimalaria case.

`pages` and `chunks` are created empty so that F004 and F005 add rows rather than tables.

## Acceptance criteria
- [ ] `pnpm --filter @tender/db migrate` applies cleanly to an empty database
- [ ] Both extensions exist afterwards on a database created without the init script
- [ ] Re-running migrations is a no-op
- [ ] A tender, document, page and chunk round-trip inserts and reads back
- [ ] A second document with the same `content_sha256` is rejected by the database
- [ ] Inserting `page_number = 0` is rejected
- [ ] drizzle-zod produces a Zod 4 schema that rejects an invalid row, proven by a test
- [ ] CI runs migrations against a Postgres service container
- [ ] `ARCHITECTURE.md` matches the tables created

## Measurement
Migration runtime on an empty database, and the `\dt` and `\di` output, recorded in the build log.

## Risks and open questions
1. drizzle-zod against Zod 4 is unproven. If it lags, that is a finding to report, not a silent downgrade to Zod 3.
2. New dependencies: `drizzle-orm`, `drizzle-kit`, `drizzle-zod`, `postgres`.
3. Schema tests need a live database and cannot be meaningfully mocked. They point at the local container and skip with a clear message when it is absent, rather than passing silently.
4. `CREATE EXTENSION` from a migration needs confirming on Neon before F006 depends on it.

## Notes from the build
Filled in during and after building.
