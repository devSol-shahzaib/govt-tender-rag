import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStubGateway, createTokenCounter } from '@tender/core';
import { chunks, createDatabase, documents, eq, pages, tenants, tenders } from '@tender/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chunkPages } from './chunk-pages.js';
import { extractPages } from './extract-pages.js';

const connectionString = process.env.TEST_DATABASE_URL;
const describeWithDb = connectionString === undefined ? describe.skip : describe;
const corpusRoot = fileURLToPath(new URL('../../../../../corpus/', import.meta.url));
const PAKPOST = 'epads/pakpost_p102751_bidding_document.pdf';
const counter = createTokenCounter('text-embedding-3-small');

describeWithDb('chunkPages', () => {
  const url = connectionString ?? '';
  let handle: ReturnType<typeof createDatabase>;
  const tenantNames: string[] = [];
  const roots: string[] = [];

  beforeAll(() => {
    handle = createDatabase(url, { max: 2 });
  });

  afterEach(async () => {
    for (const name of tenantNames.splice(0)) {
      await handle.db.delete(tenants).where(eq(tenants.name, name));
    }
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await handle.close();
  });

  /** One tenant with one real document, optionally extracted. */
  async function seed(corpusPath: string, options: { extract?: boolean } = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'tender-chunk-'));
    roots.push(root);
    await mkdir(path.join(root, path.dirname(corpusPath)), { recursive: true });
    await copyFile(path.join(corpusRoot, corpusPath), path.join(root, corpusPath));

    const name = `chunk test ${randomUUID()}`;
    tenantNames.push(name);
    const [tenant] = await handle.db.insert(tenants).values({ name }).returning();
    const tenantId = tenant?.id ?? '';
    const [tender] = await handle.db
      .insert(tenders)
      .values({ tenantId, reference: `ref-${randomUUID()}`, agency: 'A', title: 'T' })
      .returning();
    const [document] = await handle.db
      .insert(documents)
      .values({
        tenantId,
        tenderId: tender?.id ?? '',
        filePath: corpusPath,
        docType: 'bidding_document',
        publishedOn: '2026-08-24',
        contentSha256: `sha-${randomUUID()}`,
      })
      .returning();

    if (options.extract !== false) {
      await extractPages(handle.db, {
        corpusRoot: root,
        tenantId,
        gateway: createStubGateway({ text: 'unused' }),
      });
    }

    return { tenantId, documentId: document?.id ?? '' };
  }

  it('stores every chunk on a single page', async () => {
    const { tenantId, documentId } = await seed(PAKPOST);

    const report = await chunkPages(handle.db, counter, { tenantId });
    const stored = await handle.db.select().from(chunks).where(eq(chunks.documentId, documentId));

    expect(report.documentsChunked).toBe(1);
    expect(stored.length).toBe(report.chunksCreated);
    expect(stored.every((c) => c.firstPage === c.lastPage)).toBe(true);
  });

  it('keeps the EPADS footer out of chunks while pages keep it verbatim', async () => {
    const { tenantId, documentId } = await seed(PAKPOST);
    await chunkPages(handle.db, counter, { tenantId });

    const storedChunks = await handle.db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, documentId));
    const storedPages = await handle.db
      .select()
      .from(pages)
      .where(eq(pages.documentId, documentId));

    expect(storedChunks.filter((c) => c.text.includes('generated document'))).toEqual([]);
    expect(storedPages.some((p) => (p.text ?? '').includes('generated document'))).toBe(true);
  });

  it('builds nothing on a second run when nothing changed', async () => {
    // From F006 on, a rebuild means paying to embed every chunk again.
    const { tenantId } = await seed(PAKPOST);
    await chunkPages(handle.db, counter, { tenantId });

    const second = await chunkPages(handle.db, counter, { tenantId });

    expect(second.documentsSkipped).toBe(1);
    expect(second.chunksCreated).toBe(0);
  });

  it('rebuilds when the fingerprint no longer matches, replacing rather than adding', async () => {
    const { tenantId, documentId } = await seed(PAKPOST);
    const first = await chunkPages(handle.db, counter, { tenantId });

    // Stands in for a new chunker or extractor version.
    await handle.db
      .update(documents)
      .set({ chunkFingerprint: 'older-inputs' })
      .where(eq(documents.id, documentId));
    const second = await chunkPages(handle.db, counter, { tenantId });

    const stored = await handle.db.select().from(chunks).where(eq(chunks.documentId, documentId));
    expect(second.documentsChunked).toBe(1);
    expect(stored.length).toBe(first.chunksCreated);
  });

  it('rebuilds when the tokenizer encoding changes, since sizes are measured in it', async () => {
    const { tenantId } = await seed(PAKPOST);
    await chunkPages(handle.db, counter, { tenantId });

    const other = { ...counter, encoding: 'another_encoding' };
    const second = await chunkPages(handle.db, other, { tenantId });

    expect(second.documentsChunked).toBe(1);
    expect(second.documentsSkipped).toBe(0);
  });

  it('reports a document with no pages instead of skipping it quietly', async () => {
    const { tenantId } = await seed(PAKPOST, { extract: false });

    const report = await chunkPages(handle.db, counter, { tenantId });

    expect(report.documentsWithoutPages).toEqual([PAKPOST]);
    expect(report.chunksCreated).toBe(0);
  });

  it('refuses to chunk pages produced by an older extractor', async () => {
    const { tenantId, documentId } = await seed(PAKPOST);
    await handle.db
      .update(documents)
      .set({ extractorVersion: 'lines-v1' })
      .where(eq(documents.id, documentId));

    const report = await chunkPages(handle.db, counter, { tenantId });

    expect(report.documentsStale).toEqual([PAKPOST]);
    expect(await handle.db.select().from(chunks).where(eq(chunks.documentId, documentId))).toEqual(
      [],
    );
  });

  it('writes nothing on a dry run but reports what it would build', async () => {
    const { tenantId, documentId } = await seed(PAKPOST);

    const report = await chunkPages(handle.db, counter, { tenantId, dryRun: true });

    expect(report.chunksCreated).toBeGreaterThan(0);
    expect(await handle.db.select().from(chunks).where(eq(chunks.documentId, documentId))).toEqual(
      [],
    );
    const [after] = await handle.db.select().from(documents).where(eq(documents.id, documentId));
    expect(after?.chunkFingerprint).toBeNull();
  });
});
