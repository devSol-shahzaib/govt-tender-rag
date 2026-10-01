import { parseArgs } from 'node:util';
import 'dotenv/config';
import { createTokenCounter } from '@tender/core';
import { createDatabase } from '@tender/db';
import { loadConfig } from '../config/env.js';
import { logger } from '../config/logger.js';
import { chunkPages } from '../modules/ingestion/chunk-pages.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      document: { type: 'string', multiple: true },
    },
  });

  const dryRun = values['dry-run'] === true;
  const config = loadConfig();

  // Needed even for a dry run: chunk sizes are measured in this model's tokens.
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? '';
  if (embeddingModel === '') {
    throw new Error('OPENAI_EMBEDDING_MODEL is not set. See apps/server/.env.example.');
  }
  const tokenCounter = createTokenCounter(embeddingModel);

  const handle = createDatabase(config.DATABASE_URL, { max: 1 });

  try {
    const report = await chunkPages(handle.db, tokenCounter, {
      dryRun,
      documentPaths: values.document,
    });

    process.stdout.write(
      [
        '',
        dryRun ? '  DRY RUN, nothing written' : '  chunking complete',
        `  documents chunked      ${String(report.documentsChunked)}`,
        `  documents skipped      ${String(report.documentsSkipped)}`,
        `  documents without pages ${String(report.documentsWithoutPages.length)}`,
        `  documents stale        ${String(report.documentsStale.length)}`,
        `  chunks created         ${String(report.chunksCreated)}`,
        `  heading-only pages     ${String(report.headingOnlyPages)}`,
        `  tokens median/p90/max  ${String(report.tokens.median)}/${String(report.tokens.p90)}/${String(report.tokens.max)} (${tokenCounter.encoding})`,
        `  oversize lines         ${String(report.oversize.length)}`,
        `  elapsed                ${String(report.elapsedMs)}ms`,
        '',
      ].join('\n'),
    );

    for (const path of report.documentsWithoutPages) {
      process.stdout.write(`  no pages yet: ${path}\n`);
    }
    for (const path of report.documentsStale) {
      process.stdout.write(`  stale, re-extract first: ${path}\n`);
    }
    for (const line of report.oversize) {
      logger.warn(
        { file: line.filePath, page: line.pageNumber, tokens: line.tokenCount },
        `Sentence over the chunk cap, kept whole: ${line.preview}`,
      );
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Chunking failed');
  process.exit(1);
});
