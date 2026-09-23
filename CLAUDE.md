# CLAUDE.md

Rules for Claude Code in this repository. Read this file fully at the start of every session.

## What this project is

A procurement document agent over public Pakistani tender documents (EPADS federal and KP Health Department). It answers questions with citations to the exact page, built with production concerns: evals, observability, cost control, multi-tenancy.

The project is built as a guided tutorial, one feature at a time. The human decides what gets built and when. Your job is to build exactly the approved feature, well, and then stop.

Read these before any work:
- `docs/PROJECT.md` for goals, scope and the feature roadmap
- `docs/ARCHITECTURE.md` for structure and how the pieces connect
- `docs/WORKFLOW.md` for the feature loop you must follow
- `docs/DECISIONS.md` for decisions that are already settled (do not reopen them)
- The current feature spec in `docs/features/`

## The golden rules

1. **One feature at a time.** Only work on a feature whose spec in `docs/features/` has `Status: Approved`. Never start the next feature, even if it seems obvious or small.
2. **Plan before code.** Before editing any file, present a numbered plan (files to create or change, tests to add, open questions) and wait for explicit approval.
3. **Small steps.** Implement the approved plan one step at a time. After each step: run the checks, show a short summary of the diff, and wait for "continue" before the next step.
4. **Ask, don't assume.** If the spec is ambiguous, a requirement conflicts with `DECISIONS.md`, or you need something outside the spec, stop and ask.
5. **Stop on repeated failure.** If the same check fails twice after your fixes, stop and report what you tried and what you think is wrong. Do not keep patching.
6. **Never claim done without evidence.** "Done" means the checks below passed and you show their output.

## Hard boundaries

- `corpus/` is read-only. Never modify, move, rename or delete anything in it.
- Never add a dependency without asking first. State the package, why it's needed, and the alternative you considered.
- Never commit secrets. All keys live in `.env.local` (git-ignored); `.env.example` lists names only.
- Never edit `docs/DECISIONS.md` unless asked. If you think a decision should change, say so and explain why.
- Never run destructive database commands (drop, truncate, reset) or force-push without explicit permission.
- Never make real LLM or embedding API calls in unit tests. Use mocks or recorded fixtures.

## Code standards

- TypeScript strict mode. No `any`, no non-null assertions (`!`) without a comment explaining why it's safe.
- Validate every external boundary with Zod: API inputs, env vars, LLM structured outputs, file metadata.
- Prefer small pure functions. Keep side effects (DB, network, filesystem) at the edges.
- Name things for what they are in the tender domain (`BiddingDocument`, `Corrigendum`, `Chunk`), not generic names (`Item`, `Data`).
- Comments explain why, not what.
- Errors: fail loudly in pipelines (ingestion, evals). In the user-facing app, degrade to an honest message, never fake data.

## AI engineering rules

These are the point of the project. Follow them even when a shortcut looks harmless.

- **All model calls go through one gateway module** (`packages/core/src/llm/`). No direct SDK calls elsewhere. This is where tracing, cost tracking, retries, caching and routing will live.
- **Model IDs come from config**, never hard-coded in feature code.
- **Prompts live in versioned files** under `packages/core/src/prompts/`, never as inline strings scattered through the code. A prompt change is a code change and gets reviewed like one.
- **The LLM never does arithmetic or date math.** Numbers, sums, deadlines and comparisons are computed in code or by tools; the model only explains them.
- **Every answer carries citations**: document ID, physical PDF page number (1-based, not the printed footer number) and the chunk it came from. No citation, no claim.
- **"Not found" is a valid answer.** When the retrieved context doesn't contain the answer, say so. Never fill gaps from general knowledge about procurement.
- **Newer amendments win.** When a corrigendum, addendum or revised document conflicts with an earlier version of the same tender, the latest one is authoritative, and the answer should say that it was amended.
- **Structured output is validated** with Zod and retried once on failure, then fails with a clear error.

## Checks to run before reporting a step as complete

```
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

`build` comes first: packages export compiled output, so from a clean tree nothing can be
typechecked until their declarations exist. This is the same order CI runs.

Plus any feature-specific check listed in the spec's acceptance criteria (for example an eval run or a script output). Paste the relevant output.

## Git

- Branches are `feat/NNN-short-name` -> `dev` -> `prod`. Cut every feature branch from `dev`.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`), one logical change per commit.
- Commit only after the human approves the step, and only on the feature branch.
- Never commit directly to `dev` or `prod`, and never merge. The human owns both merges.

## Keeping docs in sync

- If you change the folder structure, a data flow or a package boundary, update `docs/ARCHITECTURE.md` in the same step.
- At the end of a feature, draft a `docs/BUILD_LOG.md` entry (facts, numbers, what broke, what was learned) and show it for approval before appending.
- Mark the spec `Status: Done` only when the human confirms.

## Writing style for docs and UI copy

Plain, human wording. Short sentences. No em dashes. No marketing language.
