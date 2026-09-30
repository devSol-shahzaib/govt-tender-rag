# F004: Page text extraction with OCR fallback

**Status:** Done (full OCR run deferred to ingestion)
**Module:** 0
**Branch:** feat/004-page-extraction

## Goal
Fill the `pages` table for all 64 documents with per-page text, using the PDF text layer where it exists and a vision model where it does not.

## What the corpus says

5816 pages across the 64 imported documents. The corpus has 6234 pages across 66 files, but F003 drops two byte-identical copies of a 209-page document. 62 pages have fewer than 20 extractable characters, and neither dropped copy contains any of them. Six documents have none on any page, and every one of them is an amendment:

```
 1/1    antimalaria-2025-26_corrigendum-1      4/4    furniture-hcip_prebid_minutes
 1/1    autoclaves-hcip_corrigendum-1          2/2    bemonc-516119_corrigendum-1
 1/1    furniture-hcip_corrigendum-1          14/14   bemonc-516119_prebid_minutes-2
```

Without OCR those six produce no chunks and are absent from retrieval, so D004 cannot be enforced for four of the eight tenders that have amendments. One of them changes a bid opening date from 24 February to 4 March 2026, which is exactly the fact D004 exists to protect.

Two things the corpus audit gets wrong for this purpose. Its `verdict` column classifies whole documents, and files it calls scanned often carry a text layer that is only the word `CamScanner`. Its 100-character threshold, applied per page, would send 499 EPADS section dividers with correct text layers to a vision model.

The threshold is 20 characters because the corpus has a real break there:

```
 0 chars     47   image-only pages
 1-9          4   noise
10-19        11   CamScanner watermark only
20-39        16   "Additional Forms and Documents 66"   <- real text starts
60-99       499   EPADS section dividers
```

## Scope

Gateway, `packages/core/src/llm/`, structure now and policy later:
- one entry point, with the provider SDK isolated behind it
- model IDs from config, adding `OPENAI_VISION_MODEL`
- a mock model, so tests make no real calls and D009's load testing has the same seam
- retry with backoff
- tokens and cost captured on every call

Extraction, `apps/server/src/modules/ingestion/`:
- per-page text through pdf.js into `pages`, with `extraction_method` of `text_layer`
- pages under 20 characters rendered to PNG and sent through the gateway, recorded as `ocr`
- physical 1-based page numbers, never the printed footer number
- idempotent: a document whose content hash is unchanged and already has pages is skipped
- CLI `pnpm --filter @tender/server extract:pages`, with `--limit` and `--dry-run`
- an OCR failure is recorded, the run continues, and the process exits non-zero

## Out of scope
Chunking (F005), embeddings (F006), the tsvector column (F008), any UI.

## Acceptance criteria
- [ ] 64 documents extracted, 5816 `pages` rows. Not 6234, which counts the two duplicate files F003 deliberately drops
- [ ] Exactly 62 rows with `extraction_method = 'ocr'`
- [ ] All six fully-scanned documents have non-empty text on every page
- [ ] Physical page numbering holds: `pakpost_p102751` physical page 30 is stored as 30, although it prints "Page 27 of 80"
- [ ] A re-run extracts 0 pages and makes no model calls
- [ ] `--dry-run` writes nothing and reports how many pages would need OCR
- [ ] A failing OCR call records the failure, finishes the run, and exits non-zero
- [ ] No test makes a real API call, proven by the mock model
- [ ] Tokens and cost are recorded for every gateway call

## Measurement
Runtime, pages per second, OCR call count, and total tokens and cost from the gateway, recorded in the build log.

## Spending
The first real OCR run is `--limit 3`, on the antimalaria corrigendum, one page of the BEmONC pre-bid minutes table, and one image-only page from a bidding document. Its measured cost and output quality are reported before the remaining pages are run. No full run without approval.

## Risks and open questions
1. `OPENAI_API_KEY` is not configured anywhere yet. Everything except the OCR pages can be built and tested without it.
2. Image size drives cost. A page renders to about 599KB at scale 2 and about 300KB at scale 1.5. Worth measuring whether the lower scale costs less with no accuracy loss.
3. The pre-bid minutes are a table with query and response columns. If OCR flattens it, a bidder question ends up attached to the wrong answer. The prompt should ask for the table to be preserved as markdown, which is also the shape F005 wants.
4. OCR accuracy is not something the acceptance criteria can assert. They check that text exists. Correctness is a manual spot-check of the corrigendum's dates against the PDF.
5. Tesseract remains a fallback if quality disappoints, but it would supersede D012's vision clause.

## Notes from the build
Closed with the full OCR run deferred to ingestion, by decision. The code is complete and
tested; running it on the remaining 59 OCR pages would cost the same now as at ingestion.

Deferred to the ingestion run, because they need the full run:
- 64 documents extracted, 5816 `pages` rows
- exactly 62 rows with `extraction_method = 'ocr'`
- all six fully scanned documents with text on every page. Two are done: the antimalaria
  corrigendum and BEmONC corrigendum-1, from the three-page sample

Partly met: an OCR failure is recorded and the run continues, both tested. The non-zero exit
code exists in the CLI but is checked by reading the code, not by a test.

The model is gpt-6-luna with reasoning effort `none`, recorded as D020. The sample read every
date and deadline exactly, including handwritten corrections over printed times.

## Handovers
- F005 or F008: OCR returns superscript ordinals such as `24ᵗʰ`. A keyword search for `24th`
  will not match them. Apply NFKC normalisation to the search copy of the text and keep the
  original for citations.
- F009: a corrigendum can contradict itself. The antimalaria corrigendum gives the original
  opening time as 11.00 am in one item and 11.30 am in the next. The new time agrees in both.
- Ingestion: the pre-bid minutes table has not been OCR'd yet. Spot-check that each bidder
  query stays in the same row as its response. If it does not, those documents need
  re-extracting with a stronger model, and a `--force` option has to be built first.
