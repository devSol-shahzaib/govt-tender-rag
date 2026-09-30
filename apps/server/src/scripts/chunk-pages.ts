import { parseArgs } from 'node:util';
import 'dotenv/config';
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
  const handle = createDatabase(config.DATABASE_URL, { max: 1 });

  try {
    const report = await chunkPages(handle.db, { dryRun, documentPaths: values.document });

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
        `  tokens median/p90/max  ${String(report.tokens.median)}/${String(report.tokens.p90)}/${String(report.tokens.max)} (approximate)`,
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
