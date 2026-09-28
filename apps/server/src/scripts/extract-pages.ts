import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { Gateway, type ModelPricing } from '@tender/core';
import { createDatabase } from '@tender/db';
import { loadConfig } from '../config/env.js';
import { logger } from '../config/logger.js';
import { extractPages } from '../modules/ingestion/extract-pages.js';

const CORPUS_ROOT = fileURLToPath(new URL('../../../../corpus/', import.meta.url));

/**
 * Prices are read from the environment, never hard-coded.
 *
 * Provider pricing changes, and a stale constant in the repo would report a cost that
 * looks measured and is not. With nothing configured, cost is reported as unknown.
 */
function parsePrice(name: string): number | undefined {
  const raw = (process.env[name] ?? '').trim();

  // Blank is unset, not zero. Number('') is 0, so a blank placeholder would otherwise
  // report a cost of $0.0000, which reads as a measurement and is not one.
  if (raw === '') return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function visionPricing(modelId: string): Record<string, ModelPricing> {
  const input = parsePrice('OPENAI_VISION_INPUT_PER_MTOK');
  const output = parsePrice('OPENAI_VISION_OUTPUT_PER_MTOK');

  // Both or neither. One price alone would produce a cost that silently ignores half
  // the tokens.
  if (input === undefined || output === undefined) return {};

  return { [modelId]: { inputPerMillionUsd: input, outputPerMillionUsd: output } };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      limit: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const dryRun = values['dry-run'] === true;
  const ocrLimit = values.limit === undefined ? undefined : Number(values.limit);

  if (ocrLimit !== undefined && (!Number.isInteger(ocrLimit) || ocrLimit < 0)) {
    throw new Error(`--limit must be a non-negative integer, got ${String(values.limit)}`);
  }

  const config = loadConfig();

  // Checked up front rather than letting 62 calls fail one at a time with the same
  // error. A dry run needs no key, because it makes no calls.
  if (!dryRun && (process.env.OPENAI_API_KEY ?? '') === '') {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to apps/server/.env, or pass --dry-run to see ' +
        'how many pages would need OCR without making any calls.',
    );
  }

  const models = { main: '', cheap: '', embedding: '', vision: '' };
  const visionModel = process.env.OPENAI_VISION_MODEL ?? '';

  if (!dryRun && visionModel === '') {
    throw new Error('OPENAI_VISION_MODEL is not set. See apps/server/.env.example.');
  }

  const gateway = new Gateway({
    models: { ...models, vision: visionModel },
    pricing: visionPricing(visionModel),
  });

  const handle = createDatabase(config.DATABASE_URL, { max: 1 });

  try {
    const report = await extractPages(handle.db, {
      corpusRoot: CORPUS_ROOT,
      gateway,
      ocrLimit,
      dryRun,
      onProgress: (message) => {
        process.stdout.write(`  ${message}\n`);
      },
    });

    const cost =
      report.usage.costUsd === undefined
        ? 'unknown (set OPENAI_VISION_INPUT_PER_MTOK and OPENAI_VISION_OUTPUT_PER_MTOK)'
        : `$${report.usage.costUsd.toFixed(4)}`;

    process.stdout.write(
      [
        '',
        dryRun ? '  DRY RUN, nothing written' : '  extraction complete',
        `  documents processed  ${String(report.documentsProcessed)}`,
        `  documents skipped    ${String(report.documentsSkipped)}`,
        `  pages inserted       ${String(report.pagesInserted)}`,
        `    from text layer    ${String(report.pagesFromTextLayer)}`,
        `    from OCR           ${String(report.pagesFromOcr)}`,
        `  OCR calls            ${String(report.usage.calls)}`,
        `  tokens in/out        ${String(report.usage.inputTokens)}/${String(report.usage.outputTokens)}`,
        `  cost                 ${cost}`,
        `  OCR failures         ${String(report.ocrFailures.length)}`,
        `  elapsed              ${String(report.elapsedMs)}ms`,
        '',
      ].join('\n'),
    );

    for (const failure of report.ocrFailures) {
      logger.error(
        { file: failure.filePath, page: failure.pageNumber },
        `OCR failed: ${failure.message}`,
      );
    }

    // Non-zero on any failure, so a page missing its text cannot pass unnoticed even
    // though the run finished the rest.
    if (report.ocrFailures.length > 0) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Page extraction failed');
  process.exit(1);
});
