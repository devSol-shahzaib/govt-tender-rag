# Build log

Dated notes written at the end of each feature. Facts, numbers, what broke, what was learned. This is the raw material for the blog series, so be specific.

Entry format:

```
## YYYY-MM-DD  FNNN Feature name
What was built:
Numbers:
What broke / surprised me:
What I learned:
Blog material:
```

---

## 2026-09-19  Corpus collection and audit
What was built: Corpus of public tenders from EPADS (federal) and KP Health Department, plus an audit script (`scripts/audit-corpus.mjs`) checking page counts, text layer and sources.csv consistency.
Numbers: 65 files before cleanup, about 58 unique full documents. 88% digital. 6 scanned, 2 mixed. 8 tenders with original plus amendment.
What broke / surprised me: Every scanned file is a corrigendum or pre-bid minutes. The documents that change the answers are the ones a text-only pipeline can't read. EPADS only exposes the latest merged version of a tender, so original plus corrigendum pairs had to come from agency sites. Even digital EPADS files have about 12 near-empty form pages, so "digital" had to be defined as 75%+ of pages with text. Found a triple duplicate saved under three names.
What I learned: Tender notices are not tender documents. Corrigenda override the original. Printed page numbers don't match physical pages.
Blog material: Post 1 (what I'm building and what I expect to break), and the opening of the "confident nonsense" post.

## 2026-09-25  F002 Database schema and pgvector setup
What was built: Drizzle schema and migrations for tenants, tenders, documents, pages and chunks, every table carrying tenant_id. Extensions are created by migration 0000 rather than only by the Docker init script, so local, CI and a managed host share one path. Six schema tests run against a real database inside transactions that always roll back. CI gained a Postgres service container.
Numbers: 5 tables, 11 indexes, 1.31s to migrate an empty database. 18 tests in packages/db, 46 across the workspace. 313 lines of package source at the point we reconsidered the packages/ boundary and kept it.
What broke / surprised me: sources.csv covered 38 of 66 files, and every missing row was KP Health, which holds every corrigendum, addendum and scanned document in the corpus. F003 would have imported 38 documents and reported success. kphealth_antimalaria-2025-26 has a document labelled revised dated 16-January-2026 and one labelled original dated 06-February-2026, so the revised one is older and no label can order a tender's documents. pgvector is not a trusted extension, so CREATE EXTENSION needs a superuser, while the app role is deliberately not one because superusers bypass row-level security: two correct decisions in direct conflict, found when the first migration failed. drizzle-kit migrate swallowed that failure entirely, printing a spinner, exit code 1 and no message; the real error only appeared through psql with ON_ERROR_STOP=1. apps/server/.env and the database disagreed about the app role password for four days, because nothing had ever connected: F001 validated DATABASE_URL as a string and never opened a connection, and the role script set the password inside an IF NOT EXISTS branch that never fired for an existing role. Testing that password from inside the container showed both candidates working, because pg_hba.conf trusts local connections there. psql's \quit ignores its argument and exits 0, so the script's own guard reported success on failure.
What I learned: A document's label does not tell you when it arrived. Config that nothing exercises is not verified, only well formed. Validating that a connection string parses proves nothing about whether it connects.
Blog material: the four-day credential drift and why Zod validation is not a connection test; the revised-is-older ordering trap; extension privileges versus row-level security as a genuine architectural fork.

## 2026-09-27  F003 Corpus manifest import
What was built: Manifest parsing with per-row Zod validation, a coverage check in both directions, SHA-256 hashing of each document, and an idempotent importer. CLI entry at `pnpm --filter @tender/server import:corpus`.
Numbers: 66 manifest rows became 48 tenders and 64 documents in 765ms. A re-run inserted 0 and updated 64 in 489ms. 2 rows skipped, 0 duplicates rejected. 32 new tests, 78 across the workspace.
What broke / surprised me: The manifest carries two date formats in one column, split by source, and both come out a day early through new Date(), which reads them as local midnight and converts to UTC. published_on is the only key that orders amendments, so that error would have been silent, uniform and entirely plausible. The known duplicate turned out to be a triple, and the third copy carries the tender_id test_p96607, a tender that does not exist. The rule "keep the file that follows the naming convention" resolved only one of the two discards, because both ngc_p96607 and test_p96607 follow it; the right file was winning by alphabetical accident. The duplicate-rejection path is unreachable on this corpus, since the test_ and blank rules remove both copies first, and it was also broken: drizzle wraps driver errors, so the Postgres code and constraint_name sit on cause. It would have crashed the first time it mattered. The server could not import drizzle-orm under pnpm's strict layout, so the operators are re-exported from @tender/db instead. Sorting by published_on leaves an addendum and pre-bid minutes tied on 18 May for kphealth_bemonc-516119, which F009 will need a rule for.
What I learned: A rule that produces the right answer is not the same as a rule that produces it for the right reason. Code paths the real data cannot reach are untested by construction unless a fixture reaches them.
Blog material: a timezone day-shift in the column that orders amendments; dead code only a constructed fixture can test; "follows the naming convention" turning out to be ambiguous.
