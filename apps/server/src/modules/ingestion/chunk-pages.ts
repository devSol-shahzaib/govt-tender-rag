import { and, asc, chunks, type Database, documents, eq, pages } from '@tender/db';
import { CHUNKER_VERSION, chunkDocument, type OversizeLine } from './chunk.js';
import { EXTRACTOR_VERSION } from './extract.js';

export interface ChunkingReport {
  readonly documentsChunked: number;
  /** Chunks already built from the same inputs. Nothing to do. */
  readonly documentsSkipped: number;
  /** No pages yet, such as the documents waiting for OCR at ingestion. */
  readonly documentsWithoutPages: readonly string[];
  /**
   * Pages produced by an older extractor. Chunked only after re-extraction, since
   * chunks built on stale text would be thrown away, and from F006 on, paid for twice.
   */
  readonly documentsStale: readonly string[];
  readonly chunksCreated: number;
  readonly headingOnlyPages: number;
  readonly oversize: readonly (OversizeLine & { readonly filePath: string })[];
  readonly tokens: { readonly median: number; readonly p90: number; readonly max: number };
  readonly elapsedMs: number;
}

export interface ChunkOptions {
  /** Computes and reports, writes nothing. */
  readonly dryRun?: boolean;
  /** Restricts the run to these corpus paths. */
  readonly documentPaths?: readonly string[];
  /** Restricts the run to one tenant's documents. */
  readonly tenantId?: string;
}

/** What a document's chunks were built from. Any change means the chunks are out of date. */
export function chunkFingerprint(extractedSha256: string, extractorVersion: string): string {
  return `${extractedSha256}:${extractorVersion}:${CHUNKER_VERSION}`;
}

/** Postgres caps a statement at 65535 parameters; 500 chunks of 7 columns stays far below. */
const INSERT_BATCH = 500;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/**
 * Builds chunks for every document whose pages have changed since its chunks were
 * built. Each document is rebuilt in one transaction, so its chunks are either all old
 * or all new, never a mix.
 */
export async function chunkPages(
  db: Database,
  options: ChunkOptions = {},
): Promise<ChunkingReport> {
  const started = Date.now();
  let allDocuments = await (options.tenantId === undefined
    ? db.select().from(documents)
    : db.select().from(documents).where(eq(documents.tenantId, options.tenantId)));

  if (options.documentPaths !== undefined) {
    const wanted = new Set(options.documentPaths);
    const unknown = [...wanted].filter((p) => !allDocuments.some((d) => d.filePath === p));
    if (unknown.length > 0) {
      throw new Error(`No imported document with path: ${unknown.join(', ')}`);
    }
    allDocuments = allDocuments.filter((d) => wanted.has(d.filePath));
  }

  let documentsChunked = 0;
  let documentsSkipped = 0;
  let chunksCreated = 0;
  let headingOnlyPages = 0;
  const documentsWithoutPages: string[] = [];
  const documentsStale: string[] = [];
  const oversize: (OversizeLine & { filePath: string })[] = [];
  const sizes: number[] = [];

  for (const document of allDocuments) {
    if (document.extractedSha256 === null || document.extractorVersion === null) {
      documentsWithoutPages.push(document.filePath);
      continue;
    }

    if (document.extractorVersion !== EXTRACTOR_VERSION) {
      documentsStale.push(document.filePath);
      continue;
    }

    const fingerprint = chunkFingerprint(document.extractedSha256, document.extractorVersion);
    if (document.chunkFingerprint === fingerprint) {
      documentsSkipped += 1;
      continue;
    }

    const pageRows = await db
      .select()
      .from(pages)
      .where(eq(pages.documentId, document.id))
      .orderBy(asc(pages.pageNumber));

    if (pageRows.length === 0) {
      documentsWithoutPages.push(document.filePath);
      continue;
    }

    const result = chunkDocument(
      pageRows.map((row) => ({ pageNumber: row.pageNumber, text: row.text ?? '' })),
    );

    headingOnlyPages += result.headingOnlyPages.length;
    oversize.push(...result.oversize.map((o) => ({ ...o, filePath: document.filePath })));
    sizes.push(...result.chunks.map((c) => c.tokenCount));

    if (options.dryRun === true) {
      documentsChunked += 1;
      chunksCreated += result.chunks.length;
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.delete(chunks).where(eq(chunks.documentId, document.id));

      const rows = result.chunks.map((chunk) => ({
        tenantId: document.tenantId,
        documentId: document.id,
        // Always the same page: a chunk never crosses one (D003).
        firstPage: chunk.pageNumber,
        lastPage: chunk.pageNumber,
        sectionHeading: chunk.sectionHeading,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
      }));

      for (let start = 0; start < rows.length; start += INSERT_BATCH) {
        await tx.insert(chunks).values(rows.slice(start, start + INSERT_BATCH));
      }

      await tx
        .update(documents)
        .set({ chunkFingerprint: fingerprint })
        .where(and(eq(documents.id, document.id), eq(documents.tenantId, document.tenantId)));
    });

    documentsChunked += 1;
    chunksCreated += result.chunks.length;
  }

  sizes.sort((a, b) => a - b);

  return {
    documentsChunked,
    documentsSkipped,
    documentsWithoutPages,
    documentsStale,
    chunksCreated,
    headingOnlyPages,
    oversize,
    tokens: { median: percentile(sizes, 0.5), p90: percentile(sizes, 0.9), max: sizes.at(-1) ?? 0 },
    elapsedMs: Date.now() - started,
  };
}
