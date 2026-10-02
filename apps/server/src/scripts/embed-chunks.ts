import { parseArgs } from 'node:util';
import 'dotenv/config';
import { Gateway } from '@tender/core';
import { createDatabase } from '@tender/db';
import { loadConfig } from '../config/env.js';
import { logger } from '../config/logger.js';
import { parsePrice } from '../config/prices.js';
import { embedChunks } from '../modules/ingestion/embed-chunks.js';

function required(name: string): string {
  const value = (process.env[name] ?? '').trim();
  if (value === '') throw new Error(`${name} is not set. See apps/server/.env.example.`);
  return value;
}

function dimensions(): number {
  const raw = required('OPENAI_EMBEDDING_DIMENSIONS');
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`OPENAI_EMBEDDING_DIMENSIONS must be a positive integer, got ${raw}`);
  }
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      // Repeatable: --document epads/a.pdf --document kphealth/b.pdf
      document: { type: 'string', multiple: true },
    },
  });

  const dryRun = values['dry-run'] === true;
  const config = loadConfig();
  const embeddingModel = required('OPENAI_EMBEDDING_MODEL');
  if (!dryRun) required('OPENAI_API_KEY');

  const price = parsePrice('OPENAI_EMBEDDING_PER_MTOK');
  const gateway = new Gateway({
    models: { main: '', cheap: '', vision: '', embedding: embeddingModel },
    // Embeddings have no output tokens, so only the input price matters.
    pricing:
      price === undefined
        ? {}
        : { [embeddingModel]: { inputPerMillionUsd: price, outputPerMillionUsd: 0 } },
  });

  const handle = createDatabase(config.DATABASE_URL, { max: 1 });

  try {
    const report = await embedChunks(handle.db, {
      gateway,
      dimensions: dimensions(),
      dryRun,
      pricePerMillionUsd: price,
      documentPaths: values.document,
    });

    const cost =
      report.costUsd === undefined
        ? 'unknown (set OPENAI_EMBEDDING_PER_MTOK)'
        : `$${report.costUsd.toFixed(4)}${dryRun ? ' (estimate)' : ''}`;

    process.stdout.write(
      [
        '',
        dryRun ? '  DRY RUN, no calls, nothing written' : '  embedding complete',
        `  model                  ${report.model}`,
        `  chunks pending         ${String(report.chunksPending)}`,
        `  chunks embedded        ${String(report.chunksEmbedded)}`,
        `  chunks skipped         ${String(report.chunksSkipped)}`,
        `  chunks vanished        ${String(report.chunksVanished)}`,
        `  calls                  ${String(report.calls)}`,
        `  tokens                 ${String(report.tokens)}`,
        `  cost                   ${cost}`,
        `  elapsed                ${String(report.elapsedMs)}ms`,
        '',
      ].join('\n'),
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Embedding failed');
  process.exit(1);
});
