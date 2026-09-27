import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { createDatabase } from '@tender/db';
import { loadConfig } from '../config/env.js';
import { logger } from '../config/logger.js';
import { importCorpus } from '../modules/documents/import.js';

const CORPUS_ROOT = fileURLToPath(new URL('../../../../corpus/', import.meta.url));

async function main(): Promise<void> {
  const { DATABASE_URL } = loadConfig();
  const handle = createDatabase(DATABASE_URL, { max: 1 });

  try {
    const report = await importCorpus(handle.db, { corpusRoot: CORPUS_ROOT });

    logger.info(
      {
        tendersCreated: report.tendersCreated,
        documentsInserted: report.documentsInserted,
        documentsUpdated: report.documentsUpdated,
        byDocType: report.byDocType,
        elapsedMs: report.elapsedMs,
      },
      'Corpus import finished',
    );

    for (const row of report.skipped) {
      logger.warn({ file: row.filePath, reason: row.reason }, row.detail);
    }

    for (const row of report.duplicatesRejected) {
      logger.warn(
        { file: row.filePath, kept: row.keptFilePath },
        'Skipped a byte-identical copy of a document already imported',
      );
    }

    // Printed as well as logged: this is the number the build log records, and it
    // should be readable without reaching for a JSON formatter.
    process.stdout.write(
      [
        '',
        `  tenders created     ${String(report.tendersCreated)}`,
        `  documents inserted  ${String(report.documentsInserted)}`,
        `  documents updated   ${String(report.documentsUpdated)}`,
        `  rows skipped        ${String(report.skipped.length)}`,
        `  duplicates rejected ${String(report.duplicatesRejected.length)}`,
        `  elapsed             ${String(report.elapsedMs)}ms`,
        '',
        ...Object.entries(report.byDocType)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([type, count]) => `  ${type.padEnd(20)}${String(count)}`),
        '',
      ].join('\n'),
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Corpus import failed');
  process.exit(1);
});
