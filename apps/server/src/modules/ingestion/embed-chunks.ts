import type { Gateway } from '@tender/core';
import {
  and,
  asc,
  chunks,
  type Database,
  documents,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from '@tender/db';

export interface EmbeddingReport {
  readonly model: string;
  /** Chunks in scope that still needed a vector from this model. */
  readonly chunksPending: number;
  readonly chunksEmbedded: number;
  /** Already embedded by this model. Nothing to pay for. */
  readonly chunksSkipped: number;
  /**
   * Embedded by the API but gone before the write, because their document was rechunked
   * in the meantime. Their replacements are picked up by the next run.
   */
  readonly chunksVanished: number;
  readonly calls: number;
  /**
   * Exact, from the stored token counts on a dry run and from the API's usage otherwise.
   */
  readonly tokens: number;
  /** Undefined when no price is configured: never guessed. */
  readonly costUsd: number | undefined;
  readonly elapsedMs: number;
}

export interface EmbedOptions {
  readonly gateway: Gateway;
  /** The vector length the caller is configured for. Must match the live column. */
  readonly dimensions: number;
  /** Computes tokens and cost, makes no calls, writes nothing. */
  readonly dryRun?: boolean;
  /** Per million input tokens. Used for the dry-run estimate. */
  readonly pricePerMillionUsd?: number;
  /** Restricts the run to these corpus paths. */
  readonly documentPaths?: readonly string[];
  /** Restricts the run to one tenant's chunks. */
  readonly tenantId?: string;
  /**
   * Chunks per API call. About 100 chunks is 25k tokens: far inside the request limit,
   * and small enough that a failure loses little paid work.
   */
  readonly batchSize?: number;
}

const DEFAULT_BATCH = 100;

/** The vector length Postgres enforces on chunks.embedding, read from the live schema. */
async function liveDimensions(db: Database): Promise<number> {
  const rows = await db.execute<{ type: string }>(sql`
    SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
    WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`);
  const type = rows[0]?.type ?? '';
  const match = /^vector\((\d+)\)$/.exec(type);
  if (match?.[1] === undefined) {
    throw new Error(`chunks.embedding is "${type}", not a fixed-length vector. Run migrations.`);
  }
  return Number(match[1]);
}

/**
 * Gives every chunk in scope a vector from the gateway's embedding model.
 *
 * A chunk needs one when it has none, or when it was made by another model, so vectors
 * from two models are never compared. Rebuilt chunks are new rows with no vector, so
 * D021's fingerprint already decides what gets paid for. Each batch is written in its
 * own transaction: a run that stops loses at most one batch, and the next run resumes
 * from what is still missing.
 */
export async function embedChunks(db: Database, options: EmbedOptions): Promise<EmbeddingReport> {
  const started = Date.now();
  const model = options.gateway.embeddingModel;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;

  // Before any call: a vector that cannot be stored would be paid for and thrown away.
  const column = await liveDimensions(db);
  if (column !== options.dimensions) {
    throw new Error(
      `Configured embedding dimensions (${String(options.dimensions)}) do not match ` +
        `chunks.embedding (vector(${String(column)})). Fix the config or migrate the column.`,
    );
  }

  const scope = [];
  if (options.tenantId !== undefined) scope.push(eq(chunks.tenantId, options.tenantId));
  if (options.documentPaths !== undefined) {
    const wanted = [...new Set(options.documentPaths)];
    const found = await db
      .select({ filePath: documents.filePath })
      .from(documents)
      .where(inArray(documents.filePath, wanted));
    const unknown = wanted.filter((p) => !found.some((d) => d.filePath === p));
    if (unknown.length > 0) {
      throw new Error(`No imported document with path: ${unknown.join(', ')}`);
    }
    scope.push(inArray(documents.filePath, wanted));
  }

  const needsVector = or(
    isNull(chunks.embedding),
    sql`${chunks.embeddingModel} IS DISTINCT FROM ${model}`,
  );

  const [totals] = await db
    .select({ inScope: sql<number>`count(*)::int` })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(...scope));

  const pending = await db
    .select({ id: chunks.id, text: chunks.text, tokenCount: chunks.tokenCount })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(...scope, needsVector))
    .orderBy(asc(documents.filePath), asc(chunks.firstPage), asc(chunks.id));

  const chunksSkipped = (totals?.inScope ?? 0) - pending.length;

  if (options.dryRun === true) {
    const tokens = pending.reduce((sum, c) => sum + (c.tokenCount ?? 0), 0);
    return {
      model,
      chunksPending: pending.length,
      chunksEmbedded: 0,
      chunksSkipped,
      chunksVanished: 0,
      calls: 0,
      tokens,
      costUsd:
        options.pricePerMillionUsd === undefined
          ? undefined
          : (tokens * options.pricePerMillionUsd) / 1_000_000,
      elapsedMs: Date.now() - started,
    };
  }

  let chunksEmbedded = 0;
  let chunksVanished = 0;
  let calls = 0;
  let tokens = 0;
  let costUsd: number | undefined = 0;

  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const result = await options.gateway.embedChunks({
      texts: batch.map((c) => c.text),
      dimensions: options.dimensions,
    });

    calls += 1;
    tokens += result.usage.inputTokens;
    costUsd =
      costUsd === undefined || result.usage.costUsd === undefined
        ? undefined
        : costUsd + result.usage.costUsd;

    await db.transaction(async (tx) => {
      for (const [index, chunk] of batch.entries()) {
        const embedding = result.value[index];
        // The gateway checked there is one vector per text, so this cannot happen.
        if (embedding === undefined) throw new Error(`No vector for chunk ${chunk.id}`);

        const updated = await tx
          .update(chunks)
          .set({ embedding, embeddingModel: result.model })
          .where(eq(chunks.id, chunk.id))
          .returning({ id: chunks.id });
        if (updated.length === 0) chunksVanished += 1;
        else chunksEmbedded += 1;
      }
    });
  }

  return {
    model,
    chunksPending: pending.length,
    chunksEmbedded,
    chunksSkipped,
    chunksVanished,
    calls,
    tokens,
    costUsd,
    elapsedMs: Date.now() - started,
  };
}
