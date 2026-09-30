import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStubGateway } from '@tender/core';
import { createDatabase, documents, eq, pages, tenants, tenders } from '@tender/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { extractPages } from './extract-pages.js';

const connectionString = process.env.TEST_DATABASE_URL;
const describeWithDb = connectionString === undefined ? describe.skip : describe;
const corpusRoot = fileURLToPath(new URL('../../../../../corpus/', import.meta.url));

/** Never opens a connection. No test in this file makes a real call. */
function mockGateway(text: string, opts: { fail?: boolean } = {}) {
  return createStubGateway({
    text,
    failWith:
      opts.fail === true
        ? Object.assign(new Error('vision unavailable'), { statusCode: 503 })
        : undefined,
  });
}

describeWithDb('extractPages', () => {
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

  /** Copies real corpus PDFs into a throwaway root. corpus/ stays read-only. */
  async function seed(files: readonly { corpusPath: string; sha: string }[]) {
    const root = await mkdtemp(path.join(tmpdir(), 'tender-extract-'));
    roots.push(root);
    await mkdir(path.join(root, 'kphealth'), { recursive: true });
    await mkdir(path.join(root, 'epads'), { recursive: true });

    const tenantName = `extract test ${randomUUID()}`;
    tenantNames.push(tenantName);
    const [tenant] = await handle.db.insert(tenants).values({ name: tenantName }).returning();
    const tenantId = tenant?.id ?? '';
    const [tender] = await handle.db
      .insert(tenders)
      .values({ tenantId, reference: `ref-${randomUUID()}`, agency: 'A', title: 'T' })
      .returning();

    const inserted = [];
    for (const file of files) {
      await copyFile(path.join(corpusRoot, file.corpusPath), path.join(root, file.corpusPath));
      const [doc] = await handle.db
        .insert(documents)
        .values({
          tenantId,
          tenderId: tender?.id ?? '',
          filePath: file.corpusPath,
          docType: 'bidding_document',
          publishedOn: '2026-02-24',
          contentSha256: file.sha,
        })
        .returning();
      inserted.push(doc);
    }

    return { root, tenantId, documents: inserted };
  }

  it('stores text-layer pages with the physical page number', async () => {
    const { root, tenantId } = await seed([
      { corpusPath: 'epads/pakpost_p102751_bidding_document.pdf', sha: `a${randomUUID()}` },
    ]);

    const report = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('unused'),
    });

    expect(report.pagesInserted).toBe(83);
    expect(report.pagesFromOcr).toBe(0);
    expect(report.usage.calls).toBe(0);

    const stored = await handle.db.select().from(pages).where(eq(pages.tenantId, tenantId));
    const page30 = stored.find((p) => p.pageNumber === 30);
    expect(page30?.extractionMethod).toBe('text_layer');
    expect(page30?.text).toContain('Page 27 of 80');
  });

  it('sends only pages without a text layer to the model', async () => {
    const { root, tenantId } = await seed([
      {
        corpusPath: 'kphealth/kphealth_antimalaria-2025-26_corrigendum-1.pdf',
        sha: `b${randomUUID()}`,
      },
    ]);

    const report = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('CORRIGENDUM. Bids now open 4th March, 2026 at 11.00 am.'),
    });

    expect(report.pagesFromOcr).toBe(1);
    expect(report.usage.calls).toBe(1);
    expect(report.usage.inputTokens).toBe(800);

    const stored = await handle.db.select().from(pages).where(eq(pages.tenantId, tenantId));
    expect(stored[0]?.extractionMethod).toBe('ocr');
    expect(stored[0]?.text).toContain('4th March, 2026');
  });

  it('skips a document whose pages came from the bytes it still has', async () => {
    const { root } = await seed([
      { corpusPath: 'epads/pakpost_p102751_bidding_document.pdf', sha: `c${randomUUID()}` },
    ]);

    await extractPages(handle.db, { corpusRoot: root, gateway: mockGateway('unused') });
    const second = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('unused'),
    });

    expect(second.documentsSkipped).toBe(1);
    expect(second.pagesInserted).toBe(0);
    expect(second.usage.calls).toBe(0);
  });

  it('re-extracts when the file changed underneath the stored pages', async () => {
    const { root, documents: docs } = await seed([
      { corpusPath: 'epads/pakpost_p102751_bidding_document.pdf', sha: `d${randomUUID()}` },
    ]);
    await extractPages(handle.db, { corpusRoot: root, gateway: mockGateway('unused') });

    // A new content hash is what F003 writes when the bytes change.
    await handle.db
      .update(documents)
      .set({ contentSha256: `changed${randomUUID()}` })
      .where(eq(documents.id, docs[0]?.id ?? ''));

    const rerun = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('unused'),
    });

    expect(rerun.documentsSkipped).toBe(0);
    expect(rerun.pagesInserted).toBe(83);
  });

  it('re-extracts when the extractor changed, although the bytes did not', async () => {
    const { root, documents: docs } = await seed([
      { corpusPath: 'epads/pakpost_p102751_bidding_document.pdf', sha: `v${randomUUID()}` },
    ]);
    await extractPages(handle.db, { corpusRoot: root, gateway: mockGateway('unused') });

    // Pretend these pages came from older extraction logic.
    await handle.db
      .update(documents)
      .set({ extractorVersion: 'lines-v1' })
      .where(eq(documents.id, docs[0]?.id ?? ''));

    const rerun = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('unused'),
    });

    expect(rerun.documentsSkipped).toBe(0);
    expect(rerun.pagesInserted).toBe(83);
  });

  it('reuses OCR text instead of paying again when only the extractor changed', async () => {
    const {
      root,
      tenantId,
      documents: docs,
    } = await seed([
      {
        corpusPath: 'kphealth/kphealth_antimalaria-2025-26_corrigendum-1.pdf',
        sha: `r${randomUUID()}`,
      },
    ]);
    await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('CORRIGENDUM. Bids now open 4th March, 2026.'),
    });
    await handle.db
      .update(documents)
      .set({ extractorVersion: 'lines-v1' })
      .where(eq(documents.id, docs[0]?.id ?? ''));

    // Any call to this gateway fails, so a passing run proves no call was made.
    const rerun = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('must not be called', { fail: true }),
    });

    expect(rerun.usage.calls).toBe(0);
    expect(rerun.ocrFailures).toEqual([]);
    expect(rerun.pagesOcrReused).toBe(1);

    const stored = await handle.db.select().from(pages).where(eq(pages.tenantId, tenantId));
    expect(stored[0]?.text).toBe('CORRIGENDUM. Bids now open 4th March, 2026.');
  });

  it('records an OCR failure, continues, and leaves the document unmarked', async () => {
    const {
      root,
      tenantId,
      documents: docs,
    } = await seed([
      {
        corpusPath: 'kphealth/kphealth_antimalaria-2025-26_corrigendum-1.pdf',
        sha: `e${randomUUID()}`,
      },
    ]);

    const report = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('never returned', { fail: true }),
    });

    expect(report.ocrFailures).toHaveLength(1);
    expect(report.ocrFailures[0]?.pageNumber).toBe(1);
    // Asserted so this cannot pass for the wrong reason. It did once: pdf.js detaches
    // the buffer it is handed, so rendering failed and the test saw a failure that had
    // nothing to do with the model being unavailable.
    expect(report.ocrFailures[0]?.message).toMatch(/readPageImage failed against/);

    // Not marked extracted, so a later run retries rather than treating the gap as done.
    const [after] = await handle.db
      .select()
      .from(documents)
      .where(eq(documents.id, docs[0]?.id ?? ''));
    expect(after?.extractedSha256).toBeNull();

    const stored = await handle.db.select().from(pages).where(eq(pages.tenantId, tenantId));
    expect(stored).toEqual([]);
  });

  it('defers a whole document that needs more OCR than the limit allows', async () => {
    // The corrigendum needs 1 OCR page and fits; the minutes need 14 and do not. The
    // limit used to stop partway through a document and still mark it extracted, so
    // its remaining pages would never have been read by any later run.
    const minutesPath = 'kphealth/kphealth_bemonc-516119_prebid_minutes-2.pdf';
    const { root, documents: docs } = await seed([
      {
        corpusPath: 'kphealth/kphealth_antimalaria-2025-26_corrigendum-1.pdf',
        sha: `f${randomUUID()}`,
      },
      { corpusPath: minutesPath, sha: `f2${randomUUID()}` },
    ]);

    const report = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('page text'),
      ocrLimit: 3,
    });

    expect(report.usage.calls).toBe(1);
    expect(report.documentsDeferred).toEqual([minutesPath]);

    const minutes = docs.find((d) => d?.filePath === minutesPath);
    const [after] = await handle.db
      .select()
      .from(documents)
      .where(eq(documents.id, minutes?.id ?? ''));
    expect(after?.extractedSha256).toBeNull();
    expect(
      await handle.db
        .select()
        .from(pages)
        .where(eq(pages.documentId, minutes?.id ?? '')),
    ).toEqual([]);
  });

  it('processes only the documents named, and refuses a path it does not know', async () => {
    const wanted = 'kphealth/kphealth_antimalaria-2025-26_corrigendum-1.pdf';
    const { root } = await seed([
      { corpusPath: wanted, sha: `h${randomUUID()}` },
      { corpusPath: 'epads/pakpost_p102751_bidding_document.pdf', sha: `h2${randomUUID()}` },
    ]);

    const report = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('page text'),
      documentPaths: [wanted],
    });

    expect(report.documentsProcessed).toBe(1);
    expect(report.pagesInserted).toBe(1);

    await expect(
      extractPages(handle.db, {
        corpusRoot: root,
        gateway: mockGateway('page text'),
        documentPaths: ['kphealth/does-not-exist.pdf'],
      }),
    ).rejects.toThrow(/No imported document with path: kphealth\/does-not-exist\.pdf/);
  });

  it('writes nothing on a dry run but reports the OCR pages it would need', async () => {
    const { root, tenantId } = await seed([
      {
        corpusPath: 'kphealth/kphealth_antimalaria-2025-26_corrigendum-1.pdf',
        sha: `g${randomUUID()}`,
      },
    ]);

    const report = await extractPages(handle.db, {
      corpusRoot: root,
      gateway: mockGateway('unused'),
      dryRun: true,
    });

    expect(report.pagesFromOcr).toBe(1);
    expect(report.usage.calls).toBe(0);
    expect(await handle.db.select().from(pages).where(eq(pages.tenantId, tenantId))).toEqual([]);
  });
});
