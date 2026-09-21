Close feature $ARGUMENTS. Do not merge or commit anything until I approve.

1. Re-read the spec in docs/features/ matching $ARGUMENTS and check every acceptance criterion. For each one, say met or not met, with evidence (command output, file, test name).
2. Run pnpm typecheck, pnpm lint and pnpm test, and show the results.
3. Check whether docs/ARCHITECTURE.md needs updating and draft the change if so.
4. Draft a docs/BUILD_LOG.md entry using the format at the top of that file. Include concrete numbers and anything that broke or surprised us.
5. If a decision was made during this feature that should be recorded, draft a docs/DECISIONS.md entry (do not add it yet).
6. Show everything and wait for my approval. After approval: append the log entry, apply doc updates, set the spec status to Done, and commit with "docs: close $ARGUMENTS".
