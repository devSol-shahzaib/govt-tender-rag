# LLM gateway

The only place in the repo that calls model or embedding APIs. CLAUDE.md and D012
both require it: tracing, cost tracking, retries, caching, routing and the mock model
used by load tests (D009) all need a single choke point to live in.

What it does today:

- `readPageImage`: OCR of a rendered page (F004).
- `embedChunks`: embeddings for chunk text, checked for count, length and finite values
  before they are returned (F006).
- `createTokenCounter`: exact token counts for an embedding model, local and free.
- `createStubGateway`: the same gateway with mock models, for tests. No network call.

Answer generation arrives with F009.

Model IDs come from `../config/models.ts`, never from a literal in feature code.
