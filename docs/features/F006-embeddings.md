# F006: Embeddings and indexing

**Status:** Done
**Module:** 0
**Branch:** feat/006-embeddings

## Goal
Give every stored chunk an embedding from the configured model, stored in pgvector with an index, so F007 can retrieve by meaning. Pay for each chunk once, and never pay again for a chunk that did not change.

## What the data says
- 8227 chunks from 52 documents. About 1.78 million tokens by the characters-over-four estimate, 7.1 million characters.
- `token_count` is still that estimate. D021 says F006 replaces it with the embedding model's tokenizer.
- The chunker caps chunks at 400 estimated tokens. Real counts may run higher on text heavy with numbers, dates and codes, which is most of a Bid Data Sheet.
- pgvector is 0.8.6. An HNSW index on `vector` supports at most 2000 dimensions (`halfvec` goes to 4000), and 0.8 adds iterative index scans, which matter once queries filter by tenant.
- 12 documents, 59 pages, still wait for OCR and have no chunks.
- The gateway already uses the AI SDK, which has `embedMany`, so embedding calls need no new package.

## Scope

Exact token counts:
- a token counter for the configured embedding model, in `packages/core`, as a pure function, using `gpt-tokenizer` (approved). The encoding must match the configured model, and an unknown model fails loudly rather than falling back to a guess
- the chunker counts with it instead of characters over four, and `CHUNKER_VERSION` becomes `structure-v2`. The 400 cap now means real tokens, and every document rechunks once, before anything is embedded, so nothing is embedded twice

Gateway:
- `Gateway.embedChunks(texts)`: one entry point for embeddings, batched, retried, with usage and cost per call, like `readPageImage`
- the response is validated: one vector per input, each with the configured dimension, all finite numbers. A mismatch fails loudly
- a stub embedding model for tests, returning deterministic vectors without a network call

Storage:
- `chunks.embedding vector(N)` and `chunks.embedding_model text`, one migration. `N` comes from config and must match the column, checked before any call
- an HNSW index with cosine distance
- a chunk needs embedding when `embedding` is null or `embedding_model` differs from the configured model. Rebuilt chunks arrive with no embedding, so D021's fingerprint already decides what gets paid for
- vectors are written per batch, in the same transaction as their model ID, so a crash loses at most one batch and a rerun resumes where it stopped

CLI: `pnpm --filter @tender/server embed:chunks`, with `--dry-run` (exact tokens and estimated cost, no calls) and `--document`.

Config: `OPENAI_EMBEDDING_MODEL` (already read by `loadModelConfig`), `OPENAI_EMBEDDING_DIMENSIONS`, and an optional `OPENAI_EMBEDDING_PER_MTOK`. Without a price, cost is reported as unknown, as in F004.

## Out of scope
- Query embedding and retrieval, which is F007.
- The full-text `tsvector` index and NFKC normalisation, which are F008.
- Choosing between embedding models by retrieval quality. That needs a golden set, which is Module 2.
- OCR of the 12 deferred documents. They are chunked and embedded after ingestion runs OCR, with no code change.
- Reusing an embedding across chunk rebuilds when the text is identical. At about 1.8 million tokens for the whole corpus, a full re-embed is cheap enough that the extra bookkeeping is not yet worth it.

## Approach
Chosen: embedding columns on `chunks`, filled by an idempotent job that embeds whatever is missing or was made by another model, in batches, through the gateway.

Rejected:
- A separate `chunk_embeddings` table keyed by model. It allows two models side by side, but that comparison belongs to Module 2, and one model at a time keeps queries and the index simple.
- Embedding inside the chunking run. It would tie a free step to a paid one, and a failed API call would roll back chunking.
- Keeping the estimated token count. The cap would stay a guess, and F009 needs real counts to budget context.
- IVFFlat instead of HNSW. It needs data present to build and a tuned `lists` value; HNSW is built incrementally and needs no training.

## Data and interfaces
- Migration `0004`: `chunks.embedding vector(N)`, `chunks.embedding_model text`, an HNSW index on `embedding vector_cosine_ops`.
- `packages/core`: `countTokens(text: string): number` for the configured model. `Gateway.embedChunks(texts: readonly string[]): Promise<GatewayResult<number[][]>>`.
- `apps/server/src/modules/ingestion/embed-chunks.ts`: `embedChunks(db, gateway, options)`, returning a report of chunks embedded and skipped, calls, tokens, cost and elapsed time.
- `apps/server/src/scripts/embed-chunks.ts` and the `embed:chunks` script.
- `.env.example` gains the embedding variables, names only.
- The schema comment on `chunks` that says a chunk may span pages is corrected; D021 says it never does.

## Acceptance criteria
- [x] `token_count` comes from the embedding model's tokenizer, and no chunk exceeds 400 real tokens apart from a reported line that cannot be split
- [x] Rechunking to `structure-v2` happens before embedding, and the chunking checks from F005 still hold: one page per chunk, no EPADS footer, `Clarification Date:` with its value
- [x] The dry run reports chunks to embed, exact tokens and estimated cost, and makes 0 model calls
- [x] Every one of the 7694 rechunked chunks has an embedding of the configured dimension and `embedding_model` set
- [x] A second run with nothing changed makes 0 calls
- [x] Rechunking one document re-embeds only that document's chunks
- [x] A run stopped partway through resumes without re-embedding finished batches
- [x] A dimension mismatch between config and the column fails before any call
- [x] A response with the wrong vector count or length fails loudly, with a test
- [x] The HNSW index exists and a query uses it: `EXPLAIN` shows an index scan
- [x] Sanity check: for a sample of chunks, the nearest neighbour of a chunk's own embedding is that chunk
- [x] No real embedding calls in tests

## Measurement
Recorded in the build log: chunk count after rechunking, real token median, p90 and max, how far characters over four was off, total tokens embedded, number of calls, cost, runtime, index build time and size.

## Risks and open questions
1. **Which model and dimension.** Settled: `text-embedding-3-small` at 1536 dimensions, under the HNSW limit of 2000. The `chunks` schema comment said F006 would choose by measurement, but a fair comparison needs the Module 2 golden set, so Module 2 decides whether to switch. Switching costs a re-embed, which is cheap at this corpus size.
2. **Tokenizer dependency.** Settled: `gpt-tokenizer`, approved. Counting through the API was rejected, since it costs a call per chunk and cannot run in the pure chunker.
3. **Rechunking in F006.** Settled: yes. Real token counts will push some chunks over 400. The chunker already splits at line boundaries, so this should only change where cuts fall, but chunk count will rise and the F005 numbers will move.
4. HNSW with a tenant filter can return fewer results than asked when most neighbours belong to another tenant. There is one tenant today; F012 should turn on iterative scans.
5. Table-of-contents pages and scrambled tables (F005 risks 1 and 2) get embedded like any other text. Their effect shows up in F007 and Module 2, not here.

## Notes from the build
- Real token counts lowered the chunk count (8227 to 7694), against the prediction in risk 3.
- The tokenizer's dry-run total matched the API's usage exactly: 1,600,859 tokens.
- Duplicates, for F007: 4433 of 7694 chunks share their exact text with another. 3571 across different tenders, 674 across documents of one tender, 188 within one document, and 378 texts in both an original and a later amendment. Near-copies (same template, different values) are the larger risk: a wrong answer with a real citation.
- Proposed defence, in layers:
  1. F007: tender scope as a hard SQL filter applied before ranking (exact search within a tender is fast; iterative HNSW scan for corpus-wide queries).
  2. F007: group exact duplicates by text hash, citing the most recently published document (D004).
  3. F008: keyword search, so exact values (agency names, dates, amounts) count, not only meaning.
  4. F009: every citation checked in code before it is shown. The chunk must have been retrieved and belong to the scoped tender, and the quoted text must appear in it word for word; otherwise the claim is dropped.
  5. Module 2: a wrong-tender citation rate, measured on questions that pair near-copy tenders.
- Open for F007: store a text hash on chunks or compute it at query time, and how to scope a question that is meant to span tenders.
