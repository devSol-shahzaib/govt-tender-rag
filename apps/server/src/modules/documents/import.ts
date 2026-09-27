import path from 'node:path';
import { and, type Database, documents, eq, tenants, tenders } from '@tender/db';
import {
  hashManifestEntry,
  checkCoverage,
  formatCoverageFailure,
  listCorpusFiles,
} from './corpus.js';
import { type ManifestEntry, parseManifest, type SkippedRow } from './manifest.js';
import { readFile } from 'node:fs/promises';

export interface DuplicateRejection {
  readonly filePath: string;
  readonly keptFilePath: string;
  readonly contentSha256: string;
}

export interface ImportReport {
  readonly tenantId: string;
  readonly tendersCreated: number;
  readonly documentsInserted: number;
  readonly documentsUpdated: number;
  readonly skipped: readonly SkippedRow[];
  readonly duplicatesRejected: readonly DuplicateRejection[];
  readonly byDocType: Readonly<Record<string, number>>;
  readonly elapsedMs: number;
}

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505';
const CONTENT_HASH_INDEX = 'documents_tenant_sha_idx';

/**
 * Drizzle wraps driver errors, so the Postgres fields sit on `cause` rather than on the
 * error itself. Walking the chain rather than reading the top level keeps this working
 * whether the error arrives wrapped or raw.
 */
function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };

    if (candidate.code === UNIQUE_VIOLATION && candidate.constraint_name === constraint) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}

async function ensureTenant(db: Database, name: string): Promise<string> {
  const existing = await db.select().from(tenants).where(eq(tenants.name, name)).limit(1);
  const found = existing[0];
  if (found !== undefined) return found.id;

  const [created] = await db.insert(tenants).values({ name }).returning();
  if (created === undefined) throw new Error('Failed to create the default tenant');
  return created.id;
}

/**
 * Loads the manifest into tenders and documents.
 *
 * Nothing is written until the manifest and the corpus agree in both directions. The
 * manifest once covered 38 of 66 files, and an importer that loads what it finds would
 * have reported success on half the corpus.
 *
 * Each row runs in its own transaction, so a document rejected by the unique content
 * hash also rolls back the tender it would have created. Otherwise a duplicate leaves
 * behind a tender with no documents.
 */
export async function importCorpus(
  db: Database,
  options: { corpusRoot: string; tenantName?: string },
): Promise<ImportReport> {
  const started = Date.now();
  const corpusRoot = options.corpusRoot;

  const manifestText = await readFile(path.join(corpusRoot, 'sources.csv'), 'utf8');
  const { entries, skipped } = parseManifest(manifestText);

  const onDisk = await listCorpusFiles(corpusRoot);
  const coverage = checkCoverage(
    entries.map((e) => e.filePath),
    onDisk,
    skipped.map((s) => s.filePath),
  );

  if (coverage.missingOnDisk.length > 0 || coverage.missingFromManifest.length > 0) {
    throw new Error(
      `Corpus and manifest disagree, nothing imported.\n${formatCoverageFailure(coverage)}`,
    );
  }

  const tenantId = await ensureTenant(db, options.tenantName ?? 'Demo tenant');

  let tendersCreated = 0;
  let documentsInserted = 0;
  let documentsUpdated = 0;
  const duplicatesRejected: DuplicateRejection[] = [];
  const byDocType: Record<string, number> = {};

  for (const entry of entries) {
    const contentSha256 = await hashManifestEntry(corpusRoot, entry);
    const outcome = await importOne(db, tenantId, entry, contentSha256);

    if (outcome.kind === 'duplicate') {
      duplicatesRejected.push(outcome.rejection);
      continue;
    }

    if (outcome.kind === 'inserted') documentsInserted += 1;
    else documentsUpdated += 1;
    if (outcome.tenderCreated) tendersCreated += 1;

    byDocType[entry.docType] = (byDocType[entry.docType] ?? 0) + 1;
  }

  return {
    tenantId,
    tendersCreated,
    documentsInserted,
    documentsUpdated,
    skipped,
    duplicatesRejected,
    byDocType,
    elapsedMs: Date.now() - started,
  };
}

type Outcome =
  | { kind: 'inserted' | 'updated'; tenderCreated: boolean }
  | { kind: 'duplicate'; rejection: DuplicateRejection };

async function importOne(
  db: Database,
  tenantId: string,
  entry: ManifestEntry,
  contentSha256: string,
): Promise<Outcome> {
  try {
    return await db.transaction(async (tx) => {
      const existingTender = await tx
        .select()
        .from(tenders)
        .where(and(eq(tenders.tenantId, tenantId), eq(tenders.reference, entry.tenderReference)))
        .limit(1);

      let tenderId = existingTender[0]?.id;
      let tenderCreated = false;

      if (tenderId === undefined) {
        const [created] = await tx
          .insert(tenders)
          .values({
            tenantId,
            reference: entry.tenderReference,
            agency: entry.agency,
            title: entry.title,
          })
          .returning();
        if (created === undefined)
          throw new Error(`Failed to create tender ${entry.tenderReference}`);
        tenderId = created.id;
        tenderCreated = true;
      }

      const values = {
        tenantId,
        tenderId,
        filePath: entry.filePath,
        docType: entry.docType,
        versionLabel: entry.versionLabel,
        publishedOn: entry.publishedOn,
        sourceUrl: entry.sourceUrl,
        contentSha256,
      };

      const existingDocument = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.tenantId, tenantId), eq(documents.filePath, entry.filePath)))
        .limit(1);

      if (existingDocument[0] !== undefined) {
        await tx.update(documents).set(values).where(eq(documents.id, existingDocument[0].id));
        return { kind: 'updated', tenderCreated } satisfies Outcome;
      }

      await tx.insert(documents).values(values);
      return { kind: 'inserted', tenderCreated } satisfies Outcome;
    });
  } catch (error) {
    if (!isUniqueViolationOn(error, CONTENT_HASH_INDEX)) throw error;

    // The transaction rolled back, so any tender this row would have created is gone.
    const kept = await db
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.contentSha256, contentSha256)))
      .limit(1);

    return {
      kind: 'duplicate',
      rejection: {
        filePath: entry.filePath,
        keptFilePath: kept[0]?.filePath ?? '(unknown)',
        contentSha256,
      },
    };
  }
}
