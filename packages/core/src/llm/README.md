# LLM gateway

The only place in the repo that calls model or embedding APIs. CLAUDE.md and D012
both require it: tracing, cost tracking, retries, caching, routing and the mock model
used by load tests (D009) all need a single choke point to live in.

Nothing here yet. The gateway arrives with F006 (embeddings) and F009 (answers).

Model IDs come from `../config/models.ts`, never from a literal in feature code.
