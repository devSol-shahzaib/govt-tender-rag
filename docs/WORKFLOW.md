# Workflow: how every feature gets built

The rule: **decide in chat, build in Claude Code, one feature at a time.** Nothing gets built in a single large burst.

## The feature loop

### 1. Discuss (Claude chat, Project "Job Hunt Sprint 1")
Talk through the feature: what problem it solves, two or three possible approaches, trade-offs, what could go wrong. End with a chosen approach.

### 2. Learn (Claude chat)
If the feature introduces a new concept (chunking, embeddings, reranking, evals and so on), learn it first: the idea, how it fails, a small example. Save short notes in `docs/learning/<topic>.md`. New procurement terms go in `docs/learning/glossary.md`.

### 3. Spec (Claude chat drafts, you approve)
Copy `docs/features/_TEMPLATE.md` to `docs/features/FNNN-short-name.md` and fill it in: goal, scope, out of scope, approach, acceptance criteria, how it's measured. Set `Status: Approved` only when you're happy with it. The spec is the contract Claude Code builds against.

### 4. Plan (Claude Code, plan mode)
In Claude Code, run `/plan-feature FNNN`. Claude Code reads the spec and the docs, then proposes a numbered plan without writing code. Review it. Push back on anything too big, any new dependency, anything outside the spec.

### 5. Build (Claude Code, step by step)
Approve the plan, then let Claude Code implement one step at a time. After each step:
- read the diff yourself (this is where you learn the most)
- make sure `pnpm typecheck`, `pnpm lint`, `pnpm test` pass
- commit, then say "continue"

If a step goes sideways, stop, revert with git, and adjust the plan rather than piling on fixes.

### 6. Verify
Check every acceptance criterion in the spec. For features that affect answers or retrieval, run the eval (once it exists) and record the numbers.

### 7. Log and close
Run `/close-feature FNNN`. Claude Code drafts a build log entry and any doc updates. You approve, it appends to `docs/BUILD_LOG.md`, the spec becomes `Status: Done`, and the branch merges. If the feature produced a decision worth keeping, add it to `docs/DECISIONS.md`.

## Where things live

| Kind of thing | Where |
|---|---|
| Rules for Claude Code | `CLAUDE.md` |
| Goals, scope, roadmap | `docs/PROJECT.md` |
| Structure and data flow | `docs/ARCHITECTURE.md` |
| Settled decisions and why | `docs/DECISIONS.md` |
| One spec per feature | `docs/features/FNNN-*.md` |
| Topic notes and glossary | `docs/learning/` |
| Dated notes, numbers, what broke | `docs/BUILD_LOG.md` |
| Source PDFs (read-only) | `corpus/` |

## Definition of done (every feature)

- Every acceptance criterion in the spec is met and checked
- Typecheck, lint and tests pass
- No real API calls in tests
- `ARCHITECTURE.md` updated if structure changed
- Build log entry written with at least one concrete number or observation
- Merged to `main` from its feature branch

## Session tips for Claude Code

- Start each session fresh on a new feature. Use `/clear` between features so old context doesn't leak in.
- If Claude Code starts doing things outside the plan, stop it and point back to the spec.
- If you don't understand a piece of generated code, ask Claude Code to explain it before approving. You'll be asked about it in interviews.
- Keep a feature to roughly one or two 90-minute slots. If a spec looks bigger, split it.

## Writing style

Plain, human wording. Short sentences. No em dashes.
