# F003: Corpus manifest import

**Status:** Approved
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

## Notes from the build
Filled in during and after building.
