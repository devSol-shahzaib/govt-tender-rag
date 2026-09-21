# F001: Repo scaffold and tooling

**Status:** Approved
**Module:** 0
**Branch:** feat/001-repo-scaffold

## Goal
Turn the current folder of docs and PDFs into a working pnpm monorepo where `pnpm typecheck`, `pnpm lint` and `pnpm test` run and pass, and where a minimal client can reach the server across origins. Every later feature depends on this, and `CLAUDE.md` makes those three commands the definition of a finished step.

## Prerequisite
`corepack enable pnpm`. pnpm is not installed on the machine. Node is 24.20.0 locally and gets pinned to 24 in `engines` and CI (D013).

## Scope
- pnpm workspace: `apps/server`, `apps/client`, `packages/core`, `packages/db`
- Shared strict `tsconfig.base.json`, extended per package
- ESLint flat config and Prettier, ported from the portfolio project and extended with React rules for the client
- Vitest with one real test per package
- Server: Express 5, `config/env.ts` validating env through Zod 4, `GET /api/health`, pino request logging with a request id, `AppError` hierarchy, `errorHandler`, `validate` middleware, CORS configured against `CLIENT_ORIGIN`
- Client: `create-next-app`, one page that fetches `/api/health` and renders the status. Nothing else.
- `packages/core/src/llm/` and `src/prompts/` created with structure and a model-ID config module. No provider SDK.
- `packages/db` as an empty typed package. No schema.
- A dependency compatibility check, run and recorded (see below)
- `.env.example` with names only; `.env.local` moves to `apps/server/.env`
- GitHub Actions workflow running the three checks

## Out of scope
- All real UI: Tailwind, shadcn, layout, chat, citation viewer. F010.
- Database schema, migrations, Drizzle config. F002.
- Any model or embedding call. F006 onwards.
- Auth, tenancy, row-level security. F012.
- pg-boss and the jobs layer. First needed in F004.
- Docker for the app. The database container already exists and stays as is.

## Approach
Port the portfolio server's conventions with the deltas agreed in D011 and D013: no Mongoose, one pnpm workspace instead of side-by-side npm projects, no Vercel serverless adapter.

The client is a walking skeleton. It exists to prove the cross-origin path that D011 creates, meaning CORS preflight and a fetch from the Next.js origin to the Express origin, on day one rather than at F010. It also means lint and tsconfig are configured once for both apps instead of reconciled later.

Express 5 forwards rejected promises to the error middleware natively, so `asyncHandler` is not ported. Routes register handlers directly.

Rejected: Turborepo and Nx, because the caching they provide is not needed at this size and `pnpm -r` replaces them without a dependency. Keeping two independent npm projects, because `packages/core` must be importable by both the server and the eval runner.

## Dependency compatibility check
D013 picks Zod 4 and Express 5 ahead of the versions proven in the portfolio project. Those picks are assumptions until something runs. This feature proves them rather than discovering the problem in F006 when the gateway is being written.

Checked in F001:
- Zod 4 with the Vercel AI SDK structured output helpers: a schema compiles and a mocked structured response parses
- Express 5 with `helmet`, `cors` and `pino-http`: all four compose in `app.ts` and the health route works
- Node 24 with `pdfjs-dist`, the one dependency already in use by `scripts/audit-corpus.mjs`

Deferred to F002, because the package is not installed until then:
- Zod 4 with `drizzle-zod`

If any check fails, stop and report. Do not silently downgrade. A failure is a decision to bring back for a superseding entry in `DECISIONS.md`.

## Data and interfaces
- `GET /api/health` returns `{ status: "ok" }`
- `apps/client` single page fetches the above and renders the status
- `packages/core/src/config/models.ts` gives typed model IDs from env, with no calls
- `apps/server/src/config/env.ts` exposes `loadConfig()` and `getConfig()`, Zod validated
- Root scripts `typecheck`, `lint`, `test`, `format`, each fanning out with `pnpm -r`

## Acceptance criteria
- [ ] `pnpm install` completes from a clean checkout
- [ ] `pnpm typecheck` passes across all packages
- [ ] `pnpm lint` passes with zero warnings
- [ ] `pnpm test` runs and passes at least one real test per package
- [ ] `pnpm --filter server dev` boots and `curl localhost:PORT/api/health` returns `{"status":"ok"}`
- [ ] With both apps running, the client page renders `ok` fetched from the server, with no CORS error in the browser console
- [ ] Zod 4 compiles a schema and parses a mocked AI SDK structured output, proven by a test
- [ ] Express 5 composes with helmet, cors and pino-http, proven by the health route passing a test
- [ ] Removing a required var from `apps/server/.env` makes startup fail with a message naming the variable and never printing its value
- [ ] No `any` and no non-null assertions without a comment explaining why it is safe
- [ ] `.env.example` lists every name in the Zod schema and no values
- [ ] The CI workflow file exists and runs the three checks
- [ ] `docs/ARCHITECTURE.md` matches the structure actually created

## Measurement
Clean install to green checks, timed. The output of the three commands, and the two compatibility tests, pasted into the build log.

## Risks and open questions
1. New dependencies, all needing approval at plan time. Server runtime: `express@5`, `zod@4`, `pino`, `pino-http`, `helmet`, `cors`, `dotenv`. Client runtime: `next`, `react`, `react-dom`. Dev: `typescript`, `tsx`, `vitest`, `eslint`, `@typescript-eslint/*`, `eslint-config-next`, `prettier`, `@types/*`. No AI SDK yet, which is why the Zod 4 structured output check uses a mock.
2. Express 5 gotchas: `req.query` is a getter, and route wildcard syntax changed under path-to-regexp v8. Low impact at this size.
3. No git remote exists. The CI workflow commits fine but will not run until the repo is pushed to GitHub.
4. Feature size. At the upper end of two slots. Natural cut if it runs long: workspace and tooling first, then the two apps.

## Notes from the build
Filled in during and after building.
