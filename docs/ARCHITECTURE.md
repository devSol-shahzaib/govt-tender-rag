# Architecture

This file describes the system as it is, plus what's planned. Sections marked **(planned)** don't exist yet. Update this file whenever structure, data flow or package boundaries change.

## Repository layout

Sections marked **(planned)** do not exist yet. Everything else was created in F001.

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
    create-app-role.sql      unprivileged app role and grants; takes the password as a variable
    db-init/                 extensions, run on first container boot
  docker-compose.yml         local Postgres 17 with pgvector
  .github/workflows/ci.yml   build, typecheck, lint, test, format on dev and prod
  pnpm-workspace.yaml
  tsconfig.base.json         strict options shared by every package
  eslint.base.mjs            shared rules; each package has its own eslint.config.mjs
  apps/
    client/                  Next.js App Router
      app/                   chat UI, citation viewer, admin (planned, F010)
      lib/health.ts          reads the server health endpoint from the browser
    server/                  Node backend: HTTP API and ingestion jobs
      src/config/            env (Zod validated), logger, cors
      src/middleware/        errorHandler, validate, requestLogger
      src/modules/           health, documents, ingestion; retrieval, answers (planned)
        documents/           manifest parsing, corpus coverage, hashing, import
        ingestion/           page text extraction, OCR fallback, chunking
      src/scripts/           import-corpus, extract-pages, chunk-pages
      src/jobs/              pg-boss handlers (planned; ingestion runs as CLI scripts for now)
      src/utils/             AppError and shared helpers
  packages/
    core/                    domain logic: retrieval, answer generation, prompts, LLM gateway
      src/config/models.ts   model IDs, read from env
      src/llm/               gateway: the only place that calls a model provider. Retry,
                             usage and cost per call, and a stub gateway for tests
      src/prompts/           versioned prompt files (page-ocr.v1)
    db/                      connection string rules, Drizzle schema, migrations
      src/schema/            tenants, tenders, documents, pages, chunks
      src/client.ts          opens a connection; callers own closing it
      drizzle/               generated migrations (0000 schema, 0001 to 0003 extraction and
                             chunk tracking),
                             applied by a privileged role
    evals/                   eval runner and golden sets (Module 2)
    mcp-server/              MCP server exposing tender tools (Module 5)
  .claude/commands/          custom Claude Code commands
```

Monorepo with pnpm workspaces. Apps depend on packages; packages never import from apps.

Packages compile with `tsc` and export `dist` with declarations, never raw TypeScript, so a
compiled production server can consume them (D017). `pnpm build` therefore runs before
`pnpm typecheck` from a clean tree, and CI does so in that order. Each package carries a
`tsconfig.build.json` that keeps tests out of `dist` while the default config keeps them
visible to typecheck and type-aware lint.

`packages/` exists so the server, the Module 2 eval runner and the Module 5 MCP server share
one copy of retrieval, answer generation and the schema. The client depends on no workspace
package, which keeps it independently deployable and keeps the LLM gateway out of any browser
bundle.

The client holds no model or database credentials. It calls the server over HTTP and renders
streamed answers. Each module folder keeps its own routes, controller, service and validation,
with the database schema in `packages/db` rather than per module.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 6 (strict), pnpm workspaces, Node 24 |
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
| Tests | Vitest, Playwright (planned) |
| CI | GitHub Actions |
| Hosting | Vercel (client), Railway or Fly.io (server), Neon (DB) |

## Data flow (planned)

### Ingestion
```
sources.csv ──► tenders + documents (one document row per file, grouped by tender)
            ──► amendment order comes from documents.published_on alone, never from
                doc_type or the manifest's free-text version label (D004)
PDF ──► per-page text (pdf.js)
    ──► only pages with under 20 extractable characters go to OCR, through the gateway
        (vision model, D005). 62 of 5816 pages. Every other page keeps its text layer
    ──► pages table (document_id, physical page number, text, extraction method)
    ──► documents.extracted_sha256 and extractor_version record what produced the pages;
        a change to either re-extracts, reusing OCR text when the bytes are unchanged
    ──► chunks table: one physical page per chunk, cut at headings and clause markers,
        EPADS footer removed, heading carried across pages, token count approximate
        until F006. documents.chunk_fingerprint rebuilds a document's chunks only when
        its pages or the chunker changed
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

F001 done: pnpm workspace with two apps and two packages, strict TypeScript, ESLint 9 and
Prettier, Vitest, an Express 5 server with a health route and the middleware stack, a skeleton
client that proves the cross-origin path, and a CI workflow.

F002 done: Drizzle schema and migrations for `tenants`, `tenders`, `documents`, `pages` and
`chunks`, every table carrying `tenant_id`. CI runs migrations against a Postgres service
container and asserts the extensions exist.

F003 done: `sources.csv` imports into 48 tenders and 64 documents, idempotently, with a
coverage check in both directions before anything is written.

F004 done, full run deferred: page extraction and the OCR fallback are built and tested, and
the LLM gateway exists. Only a three-page OCR sample has run, so `pages` holds 3 rows. The
full run, 5816 pages of which 62 go to OCR, happens with ingestion. No chunks, embeddings or
UI yet.

Local Postgres 17.11 runs in Docker (container `tender-db`, databases `tender_dev` and
`tender_test`) with the `vector` and `pg_trgm` extensions loaded. Two roles: migrations use a
privileged one because pgvector is not a trusted extension, and the application uses a
non-superuser role so row-level security behaves locally the way it will on Neon (D018).
