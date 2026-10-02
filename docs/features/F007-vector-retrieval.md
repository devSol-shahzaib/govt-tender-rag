# F007: Vector retrieval with a debug CLI

**Status:** Draft
**Module:** 0
**Branch:** feat/007-vector-retrieval

## Goal
Given a question and a scope, return the chunks most similar in meaning, each with the document, physical page and section it came from. Never return a chunk from outside the scope, and never let identical copies crowd out other results. A debug CLI shows what retrieval found and why, so retrieval can be judged before an LLM answers anything.

## What the data says
- 7694 chunks with vectors, across 44 tenders that have chunks (48 imported; 4 are waiting for OCR).
- Chunks per tender: minimum 40, median 119, maximum 548. An exact search inside one tender scans a few hundred rows at most.
- 4433 chunks share their exact text with another chunk. 3571 are copies across different tenders, 674 across documents of one tender, 188 within one document. 378 texts appear in both an original and a later amendment.
- Near-copies are the bigger risk: the same EPADS template filled in with different values, such as two CDA tenders whose `Name of Procuring Agency` lines differ only in the agency name.
- 5 tenders have more than one chunked document: original plus corrigendum, addendum, revised version or pre-bid minutes.
- Tender references look like `cda_p105991` and `pakpost_p102751`.

## Scope

Query embedding:
- `Gateway.embedQuery(text)`: one text, the same model as the chunks, checked like `embedChunks`, with usage and cost per call. A question is embedded with the model recorded on the chunks it is compared against, or retrieval refuses to run.

Retrieval, in `packages/core` (D017: the Module 2 eval runner must run the same code and cannot import from an app):
- `retrieve({ question, scope, k })`
- **Scope is required.** It is either one tender (by reference) or the whole corpus, chosen explicitly. A tender scope is a SQL filter applied before ranking, so a chunk from another tender cannot be returned however similar it is.
- Within a tender: exact search (no index), since a tender has at most a few hundred chunks.
- Whole corpus: the HNSW index, with pgvector's iterative scan turned on so that filters do not leave fewer than `k` results.
- **Exact duplicates are grouped.** Results with identical text become one result. Within a tender, it is cited from the most recently published document (D004), and it lists the other locations: document, page and publication date. Across the corpus, a group lists every tender it appears in.
- Grouping happens on candidates in code, after over-fetching (for example `4 × k` rows), so no new column is needed. If fewer than `k` distinct results come back, the result says so rather than padding.
- Each result carries: chunk ID, document ID and path, tender reference, doc type, publication date, physical page, section heading, text, cosine distance, and the other locations of its text.

CLI: `pnpm --filter @tender/server retrieve "<question>" --tender <reference>` or `--all`, plus `--k` (default 5). It prints each result's rank, distance, tender, document, page, heading and the first lines of text, and marks results that have copies elsewhere or that come from an amended document.

Smoke set: about 10 hand-written questions over 3 or 4 tenders, each with the document and physical page that answers it, stored as a fixture. A script reports how many find their answer page in the top 5. It measures, it does not gate. Module 2 builds the real golden set.

## Out of scope
- Keyword search and rank fusion, which are F008.
- Generating answers, and checking citations in code, which are F009.
- An HTTP route. F009 adds the answer API; F007 is a library and a CLI.
- Reranking (Module 2) and query caching (Module 7).
- Choosing a tender from the question text. The scope comes from the caller: the CLI flag now, the UI later.
- A stored text hash column. Grouping in code over a small candidate set is cheap; revisit if F008 or Module 2 needs the hash in SQL.

## Approach
Chosen: a required scope filtered in SQL, exact search inside a tender, HNSW with iterative scan for the corpus, and exact-duplicate grouping in code with the newest document winning.

Rejected:
- Scope as a ranking boost. A near-copy from another tender could still win, which is the failure this feature exists to prevent.
- HNSW for single-tender queries. Approximate search is not needed on a few hundred rows, and an HNSW scan with a selective filter can return too few results.
- Grouping with `DISTINCT ON` in SQL. It cannot list the other locations, and the citation choice (newest document) is easier to read and test in code.
- A stored `text_sha256` column. It adds a migration and a backfill for something a few hundred candidates do not need.

## Data and interfaces
- `Gateway.embedQuery(text): Promise<GatewayResult<number[]>>`.
- `retrieve(db, gateway, { question, scope: { tender: string } | { all: true }, k }): Promise<RetrievalResult>`, with results as described in Scope, plus the query's usage and cost, and the number of candidates fetched and grouped.
- `apps/server/src/scripts/retrieve.ts` and the `retrieve` script.
- A smoke-set fixture and a runner script that prints hits at 5 per question.
- No schema change.

## Acceptance criteria
- [ ] A tender-scoped query never returns a chunk from another tender, tested with two tenders that hold near-identical chunks
- [ ] Identical texts come back as one result listing every other location, tested
- [ ] Within a tender, a text in both an original and an amendment is cited from the newest document, tested
- [ ] A query embedded with a model different from the chunks' model is refused before any search
- [ ] Corpus-wide queries use the HNSW index (`EXPLAIN`), and return `k` results when that many distinct texts exist, tested with a filter
- [ ] Tender-scoped queries return `k` distinct results when the tender has that many, or say how many it found
- [ ] The CLI prints rank, distance, tender, document, physical page and heading, and marks copies and amended documents
- [ ] The smoke set runs and its hits at 5 are recorded in the build log, with every miss looked at
- [ ] No real embedding calls in tests. A stub query vector equal to a chunk's text makes nearest-neighbour results predictable

## Measurement
Smoke-set hits at 5, query latency for a tender scope and for the whole corpus (median of the smoke set), and how often grouping merged results. Recorded in the build log.

## Risks and open questions
1. **`packages/core` gains a dependency on `packages/db`.** D017 puts retrieval in core, and retrieval queries the database, so core imports the schema and the connection type from `@tender/db`. It is a workspace package, not a new external dependency, but it is a new package boundary and `ARCHITECTURE.md` changes with it.
2. **Questions that span tenders**, such as "which tenders close this week?". Vector similarity is the wrong tool for those: they need structured data such as deadlines (CLAUDE.md: dates are computed in code). F007 offers `--all` for exploring; the answer API should probably refuse or route such questions. Worth a decision before F009.
3. **A 10-question smoke set is small.** It can show a broken pipeline, not compare two good ones. Expect Module 2 to change the numbers.
4. **Near-copies are not grouped.** Only exact text is. Inside a tender scope that is fine; across the corpus, near-copies from many tenders can still fill the top results. Corpus-wide results are for exploring only until F009 decides how cross-tender questions are handled.
5. **Pre-bid minutes and corrigenda can contradict the original.** F007 only puts the newest copy first when the text is identical. Resolving changed values across versions is F009's job (D004).

## Notes from the build
Filled in during and after building.
