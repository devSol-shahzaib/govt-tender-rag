# Decisions

Settled decisions and the reasons behind them. Claude Code must not reopen these without being asked. To change one, add a new entry that supersedes it rather than editing history.

Format: ID, date, decision, why, consequences.

---

### D001 (2026-09-18) Domain: public Pakistani tenders
**Decision:** Build the agent over public procurement tenders (EPADS federal, KP Health Department).
**Why:** Documents are public, so no user data is collected. Answers are self-grading (each fact is printed on a page). The documents are genuinely messy. Considered and rejected: a solar data bot and an electricity bill auditor (compliance risk, user data concerns).
**Consequences:** Demo runs on preloaded documents only. No user uploads in v1.

### D002 (2026-09-19) Corpus frozen for v1
**Decision:** About 58 unique documents from EPADS and KP Health. No further collection for v1.
**Why:** Passes all audit criteria (30+ full documents, 88% digital, 8 amendment pairs). More volume adds cost and review time without adding variety.
**Consequences:** A Sindh set will be added later only as a held-out eval set.

### D003 (2026-09-19) Verifiability is a product requirement
**Decision:** Every answer carries citations to the physical PDF page. The UI shows the source page next to the answer. "Not found" is a valid answer.
**Why:** Neither visitors nor the builder are procurement experts. Verification by clicking the source is how quality gets judged.
**Consequences:** Citation data must be preserved from ingestion through to the UI.

### D004 (2026-09-19) Latest amendment wins
**Decision:** When documents of the same tender conflict, the latest corrigendum, addendum or revised version is authoritative, and answers say the value was amended.
**Why:** The most damaging failure in this domain is quoting an outdated deadline or amount.
**Consequences:** Documents need `tender_id`, `doc_type`, `version` and a date. Retrieval must group by tender.

### D005 (2026-09-19) OCR only where needed, page by page
**Decision:** Use the PDF text layer when present. Send only pages without text to a vision model.
**Why:** All scanned files are amendments, so OCR is required for correctness. Only about 25 pages need it, so cost is small.
**Consequences:** Each page records its extraction method.

### D006 (2026-09-19) TypeScript everywhere, Postgres with pgvector
**Decision:** One language (TypeScript) and one database (Postgres with pgvector and full-text search).
**Why:** Vectors, keyword search, tenants and memory in one place; access control is one query. MongoDB is the builder's usual database, but joins, full-text search and row-level security matter more here.
**Consequences:** No dedicated vector database, no Python services.

### D007 (2026-09-19) No LangChain or LlamaIndex
**Decision:** Build retrieval, tool loops and evals directly on the Vercel AI SDK.
**Why:** The point is to understand and demonstrate the internals. Frameworks hide them.
**Consequences:** More code to write, but every part can be explained in an interview.

### D008 (2026-09-19) Claude models, single gateway
**Decision:** Sonnet 5 as the main model, Haiku 4.5 for cheap tasks, Opus 5 sparingly. All calls go through one gateway module; model IDs come from config.
**Why:** Good grounded answers and tool use at a mid-tier price. One gateway makes tracing, caching, routing and fallback possible later without touching feature code.
**Consequences:** No direct SDK calls outside `packages/core/src/llm/`.

### D009 (2026-09-19) Load testing uses a mock model
**Decision:** System load tests run against a mock streaming model with realistic latency. Real API tests are small and only check rate-limit handling and fallback.
**Why:** Load testing the real API measures the provider and burns money.
**Consequences:** The gateway must support swapping in a mock model.

### D010 (2026-09-19) Build one feature at a time
**Decision:** Every feature follows `docs/WORKFLOW.md`: discuss, learn, spec, plan, build in steps, verify, log.
**Why:** Keeps quality high, keeps the builder learning, produces material for the blog.
**Consequences:** No code without an approved spec.

### D011 (2026-09-21) apps/client and apps/server, server owns the API
**Decision:** Two apps. `client` is the Next.js UI only. `server` is a Node backend owning all API routes and the ingestion jobs. Module folders hold routes, controller, service and validation; the schema lives in `packages/db`.
**Why:** It matches the convention already used in the builder's portfolio project, so the structure is familiar. It also keeps model and database credentials out of the Next.js deployment, where a secret can leak into a client bundle.
**Consequences:** Streaming crosses an origin boundary, so CORS and streaming must work from F009. Two deploy targets. F001 includes a skeleton client purely to prove the cross-origin path early.

### D012 (2026-09-21) OpenAI for inference and embeddings, supersedes D008
**Decision:** OpenAI for answer generation, cheap tasks, vision OCR and embeddings. The two-tier main and cheap split from D008 stands; only the provider changes. All calls still go through one gateway at `packages/core/src/llm/`, and model IDs still come from config.
**Why:** The builder has an OpenAI key. One provider for inference and embeddings means one key, one billing view and one rate limit to reason about.
**Consequences:** D008's model choices no longer apply. The gateway must still support a mock model (D009). D005's OCR uses an OpenAI vision model.

### D013 (2026-09-21) Node 24, Express 5, Zod 4
**Decision:** Pin Node 24 in `engines` and CI. Use Express 5 and Zod 4 rather than the Express 4 and Zod 3 in the portfolio project.
**Why:** Node 24 matches the local machine, so local and CI cannot drift. Express 5 forwards rejected promises to the error middleware natively, which retires the `asyncHandler` wrapper. Zod 4 avoids a later migration across API validation, env parsing, LLM structured outputs and drizzle-zod, which are the riskiest files to touch once they carry real logic.
**Consequences:** The portfolio's `asyncHandler` is not ported. `req.query` is a getter in Express 5 and route wildcard syntax differs. Zod 4 compatibility with drizzle-zod and the AI SDK must be proven in F001, not assumed.

### D014 (2026-09-21) Branching: feat -> dev -> prod
**Decision:** Feature branches `feat/NNN-short-name` are cut from `dev`. Claude Code commits only on the feature branch and never merges. The human merges feature branches into `dev`, and merges `dev` into `prod` at deployment time.
**Why:** `dev` becomes the staging deploy and `prod` the live one once hosting exists, which matches how Vercel and Railway deploy from a named branch. Keeping merges with the human means no feature reaches shared history without a person reading the diff first.
**Consequences:** `main` was renamed to `dev`; there is no `main`. The GitHub default branch must be set to `dev` when the repo is first pushed. `prod` will not move until there is something deployed.

### D015 (2026-09-23) TypeScript pinned to 6, not 7
**Decision:** Pin TypeScript 6.0.3 across the workspace, although 7.0.2 is the current release.
**Why:** typescript-eslint 8.70 declares a peer range of `>=4.8.4 <6.1.0`, and only alpha builds go further. Type-aware linting catches unawaited promises, which is the failure mode that loses a page silently in the ingestion pipeline. That is worth more than the faster native compiler.
**Consequences:** Revisit when typescript-eslint supports 7. A future session must not "helpfully" upgrade to latest, because the break is a lint crash rather than a type error.

### D016 (2026-09-23) ESLint pinned to 9 across the workspace
**Decision:** Pin ESLint 9.39.5 and `@eslint/js` 9.39.5 for every package.
**Why:** `eslint-config-next` depends on `eslint-plugin-react` 7.37.5, which calls `context.getFilename()`, removed in ESLint 10. 7.37.5 is the latest release, so there is nothing to override to. Keeping Next's rules matters more than the newer major, and one ESLint version across the repo beats a per-package split.
**Consequences:** `eslint-config-next` declares `eslint >=9.0.0`, which is wrong given its own dependency tree caps at `^9.7`. That false declaration is why pnpm installed it without a warning, so peer ranges in this area cannot be trusted. Revisit when eslint-plugin-react supports ESLint 10.

### D017 (2026-09-23) packages/ is for server-side sharing, and exports built output
**Decision:** `packages/` exists so `apps/server`, the Module 2 eval runner and the Module 5 MCP server can share retrieval, answer generation, the LLM gateway and the schema. Packages compile with `tsc` and export `dist` with declarations, never raw TypeScript. `apps/client` depends on no workspace package.
**Why:** An eval only means something if it runs the same code as production. If that code lived in `apps/server/src/`, the eval package would import from an app, inverting the rule that packages never import from apps. Exporting raw TypeScript works under tsx, vitest and Next but breaks a compiled production server, and fixing it later means unpicking code already written against the wrong entry point. Keeping the client free of workspace dependencies stops a gateway holding API keys from ever reaching a browser bundle, and leaves the client independently deployable.
**Consequences:** `pnpm build` must run before `pnpm typecheck` from a clean tree, and CI does so. Each package carries a `tsconfig.build.json` that excludes tests from `dist` while the default config keeps them visible to typecheck and type-aware lint. Client and server stay separately deployable: Vercel builds the client from its own root directory, and the server builds with a pnpm filter or `pnpm deploy`.
