# F005: Chunking

**Status:** Done
**Module:** 0
**Branch:** feat/005-chunking

## Goal
Turn every extracted page into retrievable chunks that each sit on exactly one physical page, carry their section heading, and do not include the EPADS footer's misleading page number.

## What the stored text says
- Text-layer pages were stored as one flat line: 0 of 4515 kept any line breaks. pdf.js records where lines end (`hasEOL`), and keeping that brings back headings, BDS clause markers and field lines, in both the EPADS and KP Health templates.
- 3412 pages carry `e-Pak Acquisition and Disposal System (EPADS) generated document | © 2026 Page N of M`. That printed number is the one D003 says citations must never show.
- Page length: median about 410 tokens, p90 about 765, max about 2500. Most pages fit in one chunk.

## Scope

Re-extraction, a change to F004's code:
- keep line breaks from pdf.js. The OCR threshold ignores whitespace, so the 62 OCR pages do not change
- `documents.extractor_version`: a document is re-extracted when its bytes or the extractor changed, so future extraction changes re-run on their own without a manual `--force`
- a re-extraction reuses existing OCR text when the document's bytes are unchanged, so changing the extractor never costs money

Chunking, `apps/server/src/modules/ingestion/chunk.ts`, as pure functions:
- remove the EPADS footer from chunk text; `pages` keeps it verbatim
- cut at structure: headings, `BDS Clause Number` and `ITB Number` markers, numbered and lettered items
- merge small pieces up to a target size and split large ones at line boundaries; never cross a page
- `section_heading` is the most recent heading, carried onto the next page when that page starts mid-section
- `token_count` is approximate (characters divided by 4) and labelled as such; F006 replaces it with the embedding model's tokenizer
- chunks are rebuilt only when their inputs change, tracked by `documents.chunk_fingerprint` (extracted bytes, extractor version, chunker version). From F006 on, rebuilding chunks means paying to embed them again

CLI: `pnpm --filter @tender/server chunk:pages`, with `--dry-run`.

## Out of scope
Embeddings (F006). NFKC normalisation for search, which belongs in F008, where Postgres `normalize()` can apply it. OCR of the 12 deferred documents, which are chunked after ingestion.

## Acceptance criteria
- [x] Re-extracted text keeps structure: pakpost page 17 has `Proposal Data Sheet (BDS)` on its own line
- [x] 62 OCR pages: 3 stored plus 59 the dry run finds in the pending documents
- [x] Re-extracting the two OCR sample documents makes 0 model calls
- [x] Every chunk has `first_page = last_page`
- [x] No chunk text contains the EPADS footer, and `pages` still does
- [x] A BDS field keeps its value: `Clarification Date:` and `Tuesday, October 6, 2026` land in the same chunk
- [x] No chunk exceeds the size cap, apart from a single line that cannot be split, which is reported
- [x] `section_heading` is set where a heading exists, and carried across a page break
- [x] A second chunking run with nothing changed creates 0 chunks
- [x] The 12 deferred documents are reported, not silently skipped
- [x] Tested on both EPADS and KP Health pages

## Measurement
Chunk count, token size median, p90 and max, chunks per page, and runtime, recorded in the build log.

## Risks and open questions
1. Table-of-contents pages match the words in real questions and contain printed page numbers, such as `9. Bid Security Deposit (Where Applicable) 10`. Version 1 chunks them normally; Module 2's evals will show whether they crowd out real answers.
2. Tables such as BOQs and item lists come out as scrambled rows, and a chunk may cut through one. Evals will measure it.
3. Heading detection is a heuristic, tuned on two templates.
4. pdf.js letter spacing produces text like `P a c ka ging`. Cosmetic here, but it hurts keyword search, so it is noted for F008.

## Notes from the build
Filled in during and after building.
