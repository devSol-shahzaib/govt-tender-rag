import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Gateway, PAGE_OCR_PROMPT } from '@tender/core';
import { and, type Database, documents, eq, pages } from '@tender/db';
import { extractPageText, renderPageToPng } from './extract.js';

export interface OcrFailure {
  readonly filePath: string;
  readonly pageNumber: number;
  readonly message: string;
}

export interface ExtractionReport {
  readonly documentsProcessed: number;
  readonly documentsSkipped: number;
  readonly pagesInserted: number;
  readonly pagesFromTextLayer: number;
  readonly pagesFromOcr: number;
  readonly ocrFailures: readonly OcrFailure[];
  readonly usage: {
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    /** Undefined when any call had no price configured, never a partial guess. */
    readonly costUsd: number | undefined;
  };
  readonly elapsedMs: number;
}

export interface ExtractOptions {
  readonly corpusRoot: string;
  readonly gateway: Gateway;
  /** Caps how many pages are sent to OCR. The safety valve on spending. */
  readonly ocrLimit?: number;
  /** Reports what would happen and writes nothing. */
  readonly dryRun?: boolean;
  readonly onProgress?: (message: string) => void;
}

/**
 * Fills the pages table for every document that needs it.
 *
 * A document is skipped when its pages were extracted from the bytes it still has.
 * That is why documents.extracted_sha256 exists: "has pages" alone cannot tell a
 * finished document from one whose file changed underneath it.
 *
 * An OCR failure is recorded and the run continues. Losing 61 good pages to one bad
 * call helps nobody, and the caller exits non-zero so the gap cannot pass unnoticed.
 */
export async function extractPages(
  db: Database,
  options: ExtractOptions,
): Promise<ExtractionReport> {
  const started = Date.now();
  const report = {
    documentsProcessed: 0,
    documentsSkipped: 0,
    pagesInserted: 0,
    pagesFromTextLayer: 0,
    pagesFromOcr: 0,
    ocrFailures: [] as OcrFailure[],
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    costKnown: true,
  };

  let ocrBudget = options.ocrLimit ?? Number.POSITIVE_INFINITY;
  const allDocuments = await db.select().from(documents);

  for (const document of allDocuments) {
    if (document.extractedSha256 === document.contentSha256) {
      report.documentsSkipped += 1;
      continue;
    }

    const bytes = new Uint8Array(await readFile(path.join(options.corpusRoot, document.filePath)));
    const extracted = await extractPageText(bytes);
    const rows: { pageNumber: number; text: string; method: 'text_layer' | 'ocr' }[] = [];

    for (const page of extracted) {
      if (!page.needsOcr) {
        rows.push({ pageNumber: page.pageNumber, text: page.text, method: 'text_layer' });
        continue;
      }

      if (ocrBudget <= 0) break;
      ocrBudget -= 1;

      if (options.dryRun) {
        report.pagesFromOcr += 1;
        continue;
      }

      try {
        const image = await renderPageToPng(bytes, page.pageNumber);
        const result = await options.gateway.readPageImage({
          image,
          mediaType: 'image/png',
          prompt: PAGE_OCR_PROMPT,
        });

        report.calls += 1;
        report.inputTokens += result.usage.inputTokens;
        report.outputTokens += result.usage.outputTokens;
        if (result.usage.costUsd === undefined) report.costKnown = false;
        else report.costUsd += result.usage.costUsd;

        rows.push({ pageNumber: page.pageNumber, text: result.value, method: 'ocr' });
        options.onProgress?.(`ocr ${document.filePath} p${String(page.pageNumber)}`);
      } catch (error) {
        report.ocrFailures.push({
          filePath: document.filePath,
          pageNumber: page.pageNumber,
          message: (error as Error).message,
        });
      }
    }

    if (options.dryRun) {
      report.documentsProcessed += 1;
      continue;
    }

    // One transaction per document, so a document is either fully extracted or not at
    // all. A half-filled document would look complete to everything downstream.
    await db.transaction(async (tx) => {
      await tx.delete(pages).where(eq(pages.documentId, document.id));

      if (rows.length > 0) {
        await tx.insert(pages).values(
          rows.map((row) => ({
            tenantId: document.tenantId,
            documentId: document.id,
            pageNumber: row.pageNumber,
            text: row.text,
            extractionMethod: row.method,
          })),
        );
      }

      // Only marked extracted when no page of this document failed, so a retry picks
      // it up rather than treating a gap as finished.
      const failedHere = report.ocrFailures.some((f) => f.filePath === document.filePath);
      if (!failedHere) {
        await tx
          .update(documents)
          .set({ extractedSha256: document.contentSha256 })
          .where(and(eq(documents.id, document.id), eq(documents.tenantId, document.tenantId)));
      }
    });

    report.documentsProcessed += 1;
    report.pagesInserted += rows.length;
    report.pagesFromTextLayer += rows.filter((r) => r.method === 'text_layer').length;
    report.pagesFromOcr += rows.filter((r) => r.method === 'ocr').length;
  }

  return {
    documentsProcessed: report.documentsProcessed,
    documentsSkipped: report.documentsSkipped,
    pagesInserted: report.pagesInserted,
    pagesFromTextLayer: report.pagesFromTextLayer,
    pagesFromOcr: report.pagesFromOcr,
    ocrFailures: report.ocrFailures,
    usage: {
      calls: report.calls,
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      costUsd: report.costKnown && report.calls > 0 ? report.costUsd : undefined,
    },
    elapsedMs: Date.now() - started,
  };
}
