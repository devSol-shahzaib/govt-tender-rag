# F003: Corpus manifest import

**Status:** Done
**Module:** 0
**Branch:** feat/003-manifest-import

## Goal
Load `corpus/sources.csv` into `tenders` and `documents`, hashing each PDF, so that F004 has rows to extract pages from.

## What the data already told us

The manifest carries two date formats in one column, split by source: 38 EPADS rows read `August 24, 2026` and 28 KP Health rows read `24-February-2026`. Both parse through `new Date()`, and both come out a day early, because the string is read as local midnight and then converted to UTC. The shift is silent, uniform and plausible. Since `published_on` is the sole amendment ordering key (D004), dates are parsed with an explicit month-name map into a `YYYY-MM-DD` string, and no `Date` object is constructed.

The known duplicate is a triple, not a pair. `ngc_p96607_bidding_document.pdf`, `bidding-document.pdf` and `test_p96607_bidding_document.pdf` are byte identical. The last carries a `tender_id` that exists only because the file was downloaded a second time under a test name.

## Scope
- `apps/server/src/modules/documents/`: manifest parsing, row validation, import
- A CLI entry, `pnpm --filter @tender/server import:corpus`
- A Zod schema per CSV row. CLAUDE.md counts file metadata as an external boundary
- Explicit date parsing for both formats. Anything else aborts the run
- SHA-256 of each PDF, read from `corpus/` and never written to
- A coverage check in both directions before importing. Any mismatch aborts with the list
- Idempotent upsert keyed on `(tenant_id, file_path)`
- A default tenant, seeded if absent
- A run report: counts by `doc_type`, tenders created, duplicates skipped with the file that won

## Out of scope
Page text and OCR (F004), chunking (F005), embeddings (F006). No PDF is parsed here beyond hashing its bytes.

## Approach
Two rows are dropped before the database is touched, each for a stated reason. A `tender_id` beginning with `test_` marks a collection artefact rather than a procurement. A blank `tender_id` cannot be imported at all, because a document has nowhere to attach without a tender.

Remaining rows are ordered so that a file named `<tender_id>_<doc_type>.pdf` comes before one that is not, then by file path. Both discarded rows happen to be byte-identical copies of `ngc_p96607`, so the unique content hash would also have caught them. It stays as the general net for duplicates these two rules do not describe, and the ordering decides which copy wins when it fires.

Tenders are created only for documents that are accepted, so a rejected duplicate leaves no phantom tender behind. Without that rule `test_p96607` would become a tender with no documents.

## Acceptance criteria
- [ ] A clean import creates 1 tenant, 48 tenders and 64 documents
- [ ] Exactly 2 rows are skipped before any write, each with its reason: `test_p96607` as a collection artefact, and the blank `tender_id` row as having no tender to attach to
- [ ] `test_p96607` does not appear in `tenders`
- [ ] `ngc_p96607_bidding_document.pdf` is the surviving copy
- [ ] Every `published_on` matches its manifest date exactly, with a test covering one row of each format, including `24-February-2026` becoming `2026-02-24`
- [ ] A manifest row pointing at a missing file aborts before any write
- [ ] A PDF on disk with no manifest row aborts before any write
- [ ] A malformed date aborts, naming the row
- [ ] Re-running changes no counts and creates no duplicates
- [ ] All 8 multi-document tenders have their documents grouped under one tender

## Measurement
Import runtime for 66 files, row counts per table, and the run report, recorded in the build log.

## Risks and open questions
1. Hashing 66 PDFs is I/O bound. If it is slow, hash streams rather than whole buffers.
2. `csv-parse` is a new dependency, approved. The manifest has quoted fields containing commas and quotes, so splitting on commas by hand is not safe.
3. The upsert needs a unique index on `(tenant_id, file_path)`, which exists as `documents_tenant_path_idx`.

## Handover to F009: same-day documents need a tie-break

Sorting a tender's documents by `published_on` alone leaves ties. `kphealth_bemonc-516119`
has an addendum and a set of pre-bid minutes both dated 18 May 2026:

```
2026-05-18  addendum         addendum2
2026-05-18  prebid_minutes   prebid2
2026-05-08  corrigendum      corr2
2026-04-27  prebid_minutes   prebid1
2026-04-21  corrigendum      corr1
2026-02-24  bidding_document original
```

D004 says the latest amendment wins, and on that date two documents tie. The ordering key
is correct and stays as it is; what is missing is a rule for which of two same-day
documents is authoritative when they disagree. That belongs with answer generation, where
the conflict actually surfaces, so it is F009's to decide rather than something the
importer should guess at.

## Notes from the build
All ten acceptance criteria met.

The duplicate-rejection path is unreachable with the current corpus, because the `test_`
and blank `tender_id` rules remove both copies before the content hash is consulted. It is
covered by a fixture that constructs two conventionally named files with identical bytes.
Writing that fixture found the path was broken: drizzle wraps driver errors, so the
Postgres `code` and `constraint_name` sit on `cause` rather than on the error itself.

The server could not import `drizzle-orm` under pnpm's strict layout. Rather than add a
dependency, `and` and `eq` are re-exported from `@tender/db`, keeping the ORM an
implementation detail of the package that owns persistence.
