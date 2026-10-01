import { randomUUID } from 'node:crypto';
import { createStubGateway, createTokenCounter, type CallEvent } from '@tender/core';
import {
  chunks,
  createDatabase,
  documents,
  EMBEDDING_DIMENSIONS,
  eq,
  pages,
  sql,
  tenants,
  tenders,
} from '@tender/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chunkPages } from './chunk-pages.js';
import { embedChunks } from './embed-chunks.js';
import { EXTRACTOR_VERSION } from './extract.js';

const connectionString = process.env.TEST_DATABASE_URL;
const describeWithDb = connectionString === undefined ? describe.skip : describe;
const counter = createTokenCounter('text-embedding-3-small');

/** Six pages of distinct clauses, so every chunk has its own text and its own vector. */
function pagesFor(label: string): string[] {
  return Array.from(
    { length: 6 },
    (_, page) =>
      `${String(page + 1)}. ${label} clause on page ${String(page + 1)} about bid security.\n` +
      `${String(page + 1)}.1 The ${label} bidder shall submit documents by day ${String(page + 10)}.`,
  );
}

describeWithDb('embedChunks', () => {
  const url = connectionString ?? '';
  let handle: ReturnType<typeof createDatabase>;
  const tenantNames: string[] = [];

  beforeAll(() => {
    handle = createDatabase(url, { max: 2 });
  });

  afterEach(async () => {
    for (const name of tenantNames.splice(0)) {
      await handle.db.delete(tenants).where(eq(tenants.name, name));
    }
  });

  afterAll(async () => {
    await handle.close();
  });

  /** One tenant with two chunked documents, no vectors yet. */
  async function seed() {
    const name = `embed test ${randomUUID()}`;
    tenantNames.push(name);
    const [tenant] = await handle.db.insert(tenants).values({ name }).returning();
    const tenantId = tenant?.id ?? '';
    const [tender] = await handle.db
      .insert(tenders)
      .values({ tenantId, reference: `ref-${randomUUID()}`, agency: 'A', title: 'T' })
      .returning();

    const documentIds: string[] = [];
    for (const label of ['alpha', 'beta']) {
      const [document] = await handle.db
        .insert(documents)
        .values({
          tenantId,
          tenderId: tender?.id ?? '',
          filePath: `epads/${label}-${randomUUID()}.pdf`,
          docType: 'bidding_document',
          publishedOn: '2026-08-24',
          contentSha256: `sha-${randomUUID()}`,
          extractedSha256: `sha-${randomUUID()}`,
          extractorVersion: EXTRACTOR_VERSION,
        })
        .returning();
      const documentId = document?.id ?? '';
      documentIds.push(documentId);
      await handle.db.insert(pages).values(
        pagesFor(label).map((text, index) => ({
          tenantId,
          documentId,
          pageNumber: index + 1,
          text,
          extractionMethod: 'text_layer' as const,
        })),
      );
    }

    await chunkPages(handle.db, counter, { tenantId });
    return { tenantId, documentIds };
  }

  function recordingGateway(options: Parameters<typeof createStubGateway>[0] = {}) {
    const events: CallEvent[] = [];
    const gateway = createStubGateway({ ...options, onCall: (event) => events.push(event) });
    return { gateway, events };
  }

  async function storedChunks(tenantId: string) {
    return handle.db.select().from(chunks).where(eq(chunks.tenantId, tenantId));
  }

  it('gives every chunk a vector of the column length and records the model', async () => {
    const { tenantId } = await seed();
    const { gateway } = recordingGateway();

    const report = await embedChunks(handle.db, {
      gateway,
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
      batchSize: 5,
    });

    const stored = await storedChunks(tenantId);
    expect(stored.length).toBeGreaterThan(5);
    expect(report.chunksEmbedded).toBe(stored.length);
    expect(report.calls).toBe(Math.ceil(stored.length / 5));
    expect(stored.every((c) => c.embedding?.length === EMBEDDING_DIMENSIONS)).toBe(true);
    expect(stored.every((c) => c.embeddingModel === 'stub-embedding')).toBe(true);
  });

  it('makes no calls on a second run when nothing changed', async () => {
    const { tenantId } = await seed();
    await embedChunks(handle.db, {
      gateway: createStubGateway(),
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
    });

    const { gateway, events } = recordingGateway();
    const second = await embedChunks(handle.db, {
      gateway,
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
    });

    expect(events).toEqual([]);
    expect(second.chunksEmbedded).toBe(0);
    expect(second.chunksSkipped).toBe((await storedChunks(tenantId)).length);
  });

  it('re-embeds only the chunks of a document that was rechunked', async () => {
    const { tenantId, documentIds } = await seed();
    const [rechunked = ''] = documentIds;
    await embedChunks(handle.db, {
      gateway: createStubGateway(),
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
    });

    // Stands in for a chunker change that affects one document.
    await handle.db
      .update(documents)
      .set({ chunkFingerprint: 'older-inputs' })
      .where(eq(documents.id, rechunked));
    await chunkPages(handle.db, counter, { tenantId });

    const report = await embedChunks(handle.db, {
      gateway: createStubGateway(),
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
    });

    const rebuilt = (await storedChunks(tenantId)).filter((c) => c.documentId === rechunked);
    expect(report.chunksEmbedded).toBe(rebuilt.length);
    expect(report.chunksSkipped).toBe((await storedChunks(tenantId)).length - rebuilt.length);
  });

  it('re-embeds chunks made by a different model rather than mixing models', async () => {
    const { tenantId } = await seed();
    await embedChunks(handle.db, {
      gateway: createStubGateway(),
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
    });
    await handle.db
      .update(chunks)
      .set({ embeddingModel: 'an-older-model' })
      .where(eq(chunks.tenantId, tenantId));

    const report = await embedChunks(handle.db, {
      gateway: createStubGateway(),
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
    });

    const stored = await storedChunks(tenantId);
    expect(report.chunksEmbedded).toBe(stored.length);
    expect(stored.every((c) => c.embeddingModel === 'stub-embedding')).toBe(true);
  });

  it('resumes after a failure without paying again for batches already written', async () => {
    const { tenantId } = await seed();
    const total = (await storedChunks(tenantId)).length;

    await expect(
      embedChunks(handle.db, {
        gateway: createStubGateway({ failEmbeddingFromCall: 2 }),
        dimensions: EMBEDDING_DIMENSIONS,
        tenantId,
        batchSize: 5,
      }),
    ).rejects.toThrow(/stub embedding call 2 failed/);

    const afterFailure = await storedChunks(tenantId);
    expect(afterFailure.filter((c) => c.embedding !== null)).toHaveLength(5);

    const { gateway, events } = recordingGateway();
    const resumed = await embedChunks(handle.db, {
      gateway,
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
      batchSize: 5,
    });

    expect(resumed.chunksSkipped).toBe(5);
    expect(resumed.chunksEmbedded).toBe(total - 5);
    expect(events).toHaveLength(Math.ceil((total - 5) / 5));
  });

  it('refuses to start when the configured length does not match the column', async () => {
    const { tenantId } = await seed();
    const { gateway, events } = recordingGateway({ embeddingDimensions: 768 });

    await expect(embedChunks(handle.db, { gateway, dimensions: 768, tenantId })).rejects.toThrow(
      /768.*vector\(1536\)/,
    );
    expect(events).toEqual([]);
  });

  it('reports exact tokens and cost on a dry run, with no calls and no writes', async () => {
    const { tenantId } = await seed();
    const { gateway, events } = recordingGateway();

    const report = await embedChunks(handle.db, {
      gateway,
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
      dryRun: true,
      pricePerMillionUsd: 0.02,
    });

    const stored = await storedChunks(tenantId);
    const tokens = stored.reduce((sum, c) => sum + (c.tokenCount ?? 0), 0);
    expect(events).toEqual([]);
    expect(report.chunksPending).toBe(stored.length);
    expect(report.tokens).toBe(tokens);
    expect(report.costUsd).toBeCloseTo((tokens * 0.02) / 1_000_000, 12);
    expect(stored.every((c) => c.embedding === null)).toBe(true);
  });

  it('finds each chunk as its own nearest neighbour through the index', async () => {
    const { tenantId } = await seed();
    await embedChunks(handle.db, {
      gateway: createStubGateway(),
      dimensions: EMBEDDING_DIMENSIONS,
      tenantId,
    });

    for (const chunk of await storedChunks(tenantId)) {
      const rows = await handle.db.execute<{ id: string }>(sql`
        SELECT id FROM chunks WHERE tenant_id = ${tenantId}
        ORDER BY embedding <=> (SELECT embedding FROM chunks WHERE id = ${chunk.id})
        LIMIT 1`);
      expect(rows[0]?.id).toBe(chunk.id);
    }
  });
});
