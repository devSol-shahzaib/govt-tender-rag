# Project: Tender Document Agent

## One-line summary

An AI agent that answers questions about public Pakistani procurement tenders with page-level citations, built to production standards: retrieval that is measured, evals in CI, tracing, cost control and multi-tenancy.

## Why this project exists

1. **Hiring signal.** Show AI features that survive production, not a demo: defensible retrieval, evals, cost and latency discipline, graceful failure.
2. **Learning.** Each module teaches one AI engineering topic, then applies it to this codebase.
3. **Writing.** Every feature produces measured before and after numbers for the build-in-public blog series.

## Who it's for

- **Demo visitors** (LinkedIn, recruiters): give it 30 seconds. They must be able to verify an answer by clicking its citation.
- **Hiring managers**: judge it through the public eval page, the repo and the writeup.
- **Imagined real user**: a bid manager at a contractor who needs deadlines, eligibility, bid security and required documents from long tender PDFs.

## Corpus (frozen for v1)

- `corpus/epads/`: federal tenders from EPADS, one consistent template, all digital.
- `corpus/kphealth/`: KP Health Department tenders, agency-made PDFs, with 8 tenders that have amendments (corrigenda, addenda, revised versions, pre-bid minutes).
- `corpus/sources.csv`: one row per file (tender_id, doc_type, version, agency, url, notes).
- `corpus/corpus-audit.csv`: output of `scripts/audit-corpus.mjs`.

Known properties:
- About 58 unique full documents, 88% with a real text layer.
- All scanned files are amendments or pre-bid minutes, so OCR is required for correctness, not polish.
- EPADS PDFs have about 12 near-empty form pages each; printed page numbers don't match physical pages.
- Planned later: a Sindh held-out set to test that tuning generalises.

## Curriculum and modules

Each module follows the loop in `docs/WORKFLOW.md`: discuss, learn, spec, plan, build, verify, log.

| # | Module | What gets built |
|---|---|---|
| 0 | RAG foundation + streaming | Ingestion, OCR fallback, chunking, embeddings, hybrid search, streaming chat with citations, citation viewer, tender-at-a-glance card, auth stub |
| 1 | Observability | Tracing of every request, tokens, latency, cost per query and per tenant |
| 2 | RAG evals | Golden set of about 50 questions, retrieval and faithfulness metrics, CI gate, reranking before and after, Sindh held-out set |
| 3 | Tool calling | Agent loop with tender tools, human approval for actions with side effects |
| 4 | Agentic evals | Tool choice, argument correctness, step budget, task success |
| 5 | MCP | Tender tools exposed as an MCP server |
| 6 | Memory | Conversation summaries, per-tenant company profile for eligibility checks |
| 7 | Caching + routing | Prompt caching, exact and semantic cache, cheap and expensive model routing, load test with mock model |
| 8 | Feedback loops | Thumbs and reasons, corrections, promote to golden set |
| 9 | Fine-tuning | Distil requirement extraction into a small model, compare against the large model |

**v1 ship line:** modules 0 to 4. Modules 5 to 9 are follow-on releases, each with its own post.

## Feature roadmap (Module 0)

Features are small on purpose. Each gets a spec in `docs/features/` before any code.

| ID | Feature | Status |
|---|---|---|
| F001 | Repo scaffold and tooling (monorepo, TypeScript, lint, test, CI skeleton) | Not started |
| F002 | Database schema and pgvector setup | Not started |
| F003 | Corpus manifest import (`sources.csv` into the documents table) | Not started |
| F004 | Page-level text extraction with OCR fallback for pages without text | Not started |
| F005 | Chunking v1 | Not started |
| F006 | Embeddings and indexing | Not started |
| F007 | Vector retrieval with a debug CLI | Not started |
| F008 | Hybrid search (full-text plus vector, reciprocal rank fusion) | Not started |
| F009 | Answer API with streaming and citations | Not started |
| F010 | Chat UI with citation viewer | Not started |
| F011 | Tender-at-a-glance card | Not started |
| F012 | Auth and tenancy stub | Not started |

Modules 1 to 9 get their feature lists when we reach them.

## Out of scope for v1

- Users uploading their own documents
- Languages other than English (Urdu text in documents is kept but not specifically handled)
- Real-time scraping of tender portals
- Bid writing or submission

## Success measures

- Retrieval and answer quality numbers on the golden set, tracked over time on a public eval page
- Correct handling of amended tenders (latest version wins, with the amendment cited)
- Cost per query and p95 latency visible on a dashboard
- Nine blog posts built from `docs/BUILD_LOG.md`
