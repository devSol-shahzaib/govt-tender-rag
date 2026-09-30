import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Gateway, PAGE_OCR_PROMPT } from '@tender/core';
import { and, type Database, documents, eq, pages } from '@tender/db';
import { EXTRACTOR_VERSION, extractPageText, renderPageToPng } from './extract.js';

export interface OcrFailure {
  readonly filePath: string;
  readonly pageNumber: number;
  readonly message: string;
}

export interface ExtractionReport {
  readonly documentsProcessed: number;
  readonly documentsSkipped: number;
  /** Needed more OCR pages than the remaining budget, so left untouched for a later run. */
  readonly documentsDeferred: readonly string[];
  readonly pagesInserted: number;
  readonly pagesFromTextLayer: number;
  /** Pages whose text came from OCR, whether newly read or reused. */
  readonly pagesFromOcr: number;
  /**
   * OCR text carried over from a previous extraction of the same bytes, with no model
   * call. This is what makes changing the extractor free: the OCR output does not
   * depend on how the text layer is joined.
   */
  readonly pagesOcrReused: number;
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
  /**
   * Caps how many pages are sent to OCR. The safety valve on spending.
   *
   * Applied per document, not per page: a document that needs more OCR pages than
   * remain is deferred whole. Stopping partway through one would leave it half
   * extracted, and marking it done would mean no later run ever finishes it.
   */
  readonly ocrLimit?: number;
  /** Restricts the run to these corpus paths. Used to sample specific documents. */
  readonly documentPaths?: readonly string[];
  /**
   * Restricts the run to one tenant's documents. Tests rely on it: they run in parallel
   * against one database, and without it one test's run picks up documents another test
   * is still creating.
   */
  readonly tenantId?: string;
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
    documentsDeferred: [] as string[],
    pagesInserted: 0,
    pagesFromTextLayer: 0,
    pagesFromOcr: 0,
    pagesOcrReused: 0,
    ocrFailures: [] as OcrFailure[],
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    costKnown: true,
  };

  let ocrBudget = options.ocrLimit ?? Number.POSITIVE_INFINITY;
  let allDocuments = await (options.tenantId === undefined
    ? db.select().from(documents)
    : db.select().from(documents).where(eq(documents.tenantId, options.tenantId)));

  if (options.documentPaths !== undefined) {
    const wanted = new Set(options.documentPaths);
    const known = new Set(allDocuments.map((d) => d.filePath));
    const unknown = [...wanted].filter((p) => !known.has(p));

    // Fail rather than quietly processing fewer documents than were asked for.
    if (unknown.length > 0) {
      throw new Error(`No imported document with path: ${unknown.join(', ')}`);
    }
    allDocuments = allDocuments.filter((d) => wanted.has(d.filePath));
  }

  for (const document of allDocuments) {
    const sameBytes = document.extractedSha256 === document.contentSha256;

    // Skipped only when both the bytes and the extraction logic are unchanged. Checking
    // bytes alone meant documents extracted by older logic would never be redone.
    if (sameBytes && document.extractorVersion === EXTRACTOR_VERSION) {
      report.documentsSkipped += 1;
      continue;
    }

    // OCR text from a previous run is still valid when the bytes have not changed, since
    // it was read from the same page images. Reused rather than paid for again.
    const reusableOcr = new Map<number, string>();
    if (sameBytes) {
      const previous = await db
        .select()
        .from(pages)
        .where(and(eq(pages.documentId, document.id), eq(pages.extractionMethod, 'ocr')));
      for (const row of previous) {
        if (row.text !== null) reusableOcr.set(row.pageNumber, row.text);
      }
    }

    const bytes = new Uint8Array(await readFile(path.join(options.corpusRoot, document.filePath)));
    const extracted = await extractPageText(bytes);
    // The budget limits model calls, so pages that can reuse earlier OCR do not count.
    const ocrNeeded = extracted.filter(
      (page) => page.needsOcr && !reusableOcr.has(page.pageNumber),
    ).length;

    if (ocrNeeded > ocrBudget) {
      report.documentsDeferred.push(document.filePath);
      continue;
    }
    ocrBudget -= ocrNeeded;

    const rows: { pageNumber: number; text: string; method: 'text_layer' | 'ocr' }[] = [];

    for (const page of extracted) {
      if (!page.needsOcr) {
        rows.push({ pageNumber: page.pageNumber, text: page.text, method: 'text_layer' });
        continue;
      }

      const reused = reusableOcr.get(page.pageNumber);
      if (reused !== undefined) {
        rows.push({ pageNumber: page.pageNumber, text: reused, method: 'ocr' });
        report.pagesOcrReused += 1;
        // A real run counts OCR pages from the stored rows below; a dry run never gets
        // there, so it counts here. pagesFromOcr means new plus reused in both.
        if (options.dryRun) report.pagesFromOcr += 1;
        continue;
      }

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
          .set({ extractedSha256: document.contentSha256, extractorVersion: EXTRACTOR_VERSION })
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
    documentsDeferred: report.documentsDeferred,
    pagesInserted: report.pagesInserted,
    pagesFromTextLayer: report.pagesFromTextLayer,
    pagesFromOcr: report.pagesFromOcr,
    pagesOcrReused: report.pagesOcrReused,
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
