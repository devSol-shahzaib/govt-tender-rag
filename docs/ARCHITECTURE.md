# Architecture

This file describes the system as it is, plus what's planned. Sections marked **(planned)** don't exist yet. Update this file whenever structure, data flow or package boundaries change.

## Repository layout (planned, created in F001)

```
tender-rag-project/
  CLAUDE.md                  rules for Claude Code
  docs/                      project docs (this folder)
  corpus/                    source PDFs, read-only
    epads/
    kphealth/
    sources.csv
    corpus-audit.csv
  scripts/                   one-off and maintenance scripts
    audit-corpus.mjs
  apps/
    client/                  Next.js App Router: chat UI, citation viewer, admin
    server/                  Node backend: HTTP API and ingestion jobs
      src/config/            env (Zod validated), logger, cors, db
      src/middleware/        errorHandler, validate, requestLogger, rateLimiters
      src/modules/           documents, ingestion, retrieval, answers
      src/jobs/              pg-boss handlers
      src/utils/             AppError and shared helpers
  packages/
    core/                    domain logic: retrieval, answer generation, prompts, LLM gateway
      src/llm/               the only place that calls model or embedding APIs
      src/prompts/           versioned prompt files
    db/                      Drizzle schema, migrations, typed queries
    evals/                   eval runner and golden sets (Module 2)
    mcp-server/              MCP server exposing tender tools (Module 5)
  .claude/commands/          custom Claude Code commands
```

Monorepo with pnpm workspaces. Apps depend on packages; packages never import from apps.

The client holds no model or database credentials. It calls the server over HTTP and renders
streamed answers. Each module folder keeps its own routes, controller, service and validation,
with the database schema in `packages/db` rather than per module.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), pnpm workspaces |
| Client | Next.js App Router, React, Tailwind, shadcn/ui |
| Server | Node 24, TypeScript, Express 5, HTTP API with streaming |
| AI SDK | Vercel AI SDK (streaming, tool calling, structured output) |
| Models | OpenAI, main tier and cheap tier, model IDs from config |
| Embeddings | OpenAI embeddings, model and dimension chosen by measurement in F006 |
| Database | Postgres with pgvector on Neon, Drizzle ORM |
| Keyword search | Postgres full-text search |
| Jobs | pg-boss on the server |
| PDF | pdf.js for text layer, OpenAI vision for pages without text |
| Auth | Better Auth with organisations, Postgres row-level security |
| Tracing | Langfuse (Module 1) |
| Tests | Vitest, Playwright |
| CI | GitHub Actions |
| Hosting | Vercel (client), Railway or Fly.io (server), Neon (DB) |

## Data flow (planned)

### Ingestion
```
sources.csv ──► documents table (one row per file, with tender_id, doc_type, version)
PDF ──► per-page text (pdf.js) ──► pages without text go to OCR (vision model)
    ──► pages table (document_id, physical page number, text, extraction method)
    ──► chunks table (text, page range, section heading, token count)
    ──► embeddings (pgvector) + full-text index (tsvector)
```

### Question answering
```
question ──► query processing (cheap model, optional)
         ──► hybrid retrieval (vector + full-text, fused)
         ──► amendment resolution (prefer latest version of the same tender)
         ──► answer generation (main model, streamed, with citations)
         ──► UI: answer + citations that open the PDF at the right page
```

## Key domain concepts

- **Tender:** one procurement, identified by `tender_id`. Has one or more documents.
- **Document:** one file. Has a `doc_type` (bidding_document, corrigendum, addendum, revised, prebid_minutes, boq) and a `version`.
- **Page:** physical PDF page, 1-based. Printed footer numbers are ignored for citations.
- **Chunk:** a retrievable piece of text with its page range and section.
- **Citation:** document, physical page, chunk.

## Current state

Nothing built yet. Corpus collected and audited.

Local Postgres 17.11 runs in Docker (container `tender-db`, database `tender_dev`) with the
`vector` and `pg_trgm` extensions loaded. The app connects as a non-superuser role so that
row-level security behaves locally the way it will on Neon.
