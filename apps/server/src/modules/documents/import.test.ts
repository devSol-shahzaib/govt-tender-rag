import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, documents, eq, tenants, tenders } from '@tender/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { importCorpus } from './import.js';

const connectionString = process.env.TEST_DATABASE_URL;
const describeWithDb = connectionString === undefined ? describe.skip : describe;

if (connectionString === undefined) {
  console.warn('TEST_DATABASE_URL is not set, skipping import tests. See apps/server/.env.example');
}

const HEADER =
  'tender_id,file,doc_type,version,agency,title,url,date_on_listing,downloaded_on,source,notes';

interface Fixture {
  readonly row: string;
  readonly file?: string;
  readonly bytes?: string;
}

describeWithDb('importCorpus', () => {
  const url = connectionString ?? '';
  let handle: ReturnType<typeof createDatabase>;
  const roots: string[] = [];
  const tenantNames: string[] = [];

  beforeAll(() => {
    handle = createDatabase(url, { max: 2 });
  });

  afterEach(async () => {
    // Each test owns a uniquely named tenant; removing it cascades to its tenders and
    // documents. Scoped to rows the test created, so no truncate is ever needed.
    for (const name of tenantNames.splice(0)) {
      await handle.db.delete(tenants).where(eq(tenants.name, name));
    }
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await handle.close();
  });

  /** Builds a throwaway corpus. corpus/ itself is read-only, so nothing touches it. */
  async function makeCorpus(fixtures: readonly Fixture[], extraFiles: readonly string[] = []) {
    const root = await mkdtemp(path.join(tmpdir(), 'tender-corpus-'));
    roots.push(root);

    await mkdir(path.join(root, 'epads'), { recursive: true });
    await writeFile(
      path.join(root, 'sources.csv'),
      [HEADER, ...fixtures.map((f) => f.row)].join('\n') + '\n',
    );

    for (const fixture of fixtures) {
      if (fixture.file === undefined) continue;
      await writeFile(path.join(root, fixture.file), fixture.bytes ?? `%PDF-1.4 ${fixture.file}`);
    }
    for (const extra of extraFiles) {
      await writeFile(path.join(root, extra), '%PDF-1.4 unlisted');
    }

    return root;
  }

  function row(tenderId: string, file: string, docType = 'bidding_document') {
    return `${tenderId},${file},${docType},current,Agency,Title,https://example.test/1,"August 24, 2026",,epads,`;
  }

  function uniqueTenant() {
    const name = `test tenant ${randomUUID()}`;
    tenantNames.push(name);
    return name;
  }

  it('imports tenders and documents from the manifest', async () => {
    const root = await makeCorpus([
      {
        row: row('a_p1', 'epads/a_p1_bidding_document.pdf'),
        file: 'epads/a_p1_bidding_document.pdf',
      },
      {
        row: row('b_p2', 'epads/b_p2_bidding_document.pdf'),
        file: 'epads/b_p2_bidding_document.pdf',
      },
    ]);
    const tenantName = uniqueTenant();

    const report = await importCorpus(handle.db, { corpusRoot: root, tenantName });

    expect(report.tendersCreated).toBe(2);
    expect(report.documentsInserted).toBe(2);
    expect(report.duplicatesRejected).toEqual([]);
  });

  it('aborts before any write when a manifest row has no file on disk', async () => {
    const root = await makeCorpus([
      {
        row: row('a_p1', 'epads/a_p1_bidding_document.pdf'),
        file: 'epads/a_p1_bidding_document.pdf',
      },
      { row: row('b_p2', 'epads/b_p2_bidding_document.pdf') },
    ]);
    const tenantName = uniqueTenant();

    await expect(importCorpus(handle.db, { corpusRoot: root, tenantName })).rejects.toThrow(
      /not on disk[\s\S]*b_p2_bidding_document\.pdf/,
    );

    // "Before any write" is the part that matters: a half-finished import is worse
    // than none, because it looks like it worked.
    const created = await handle.db.select().from(tenants).where(eq(tenants.name, tenantName));
    expect(created).toEqual([]);
  });

  it('aborts before any write when a file on disk has no manifest row', async () => {
    // The failure that nearly shipped: a manifest covering part of the corpus imports
    // cleanly and reports success.
    const root = await makeCorpus(
      [
        {
          row: row('a_p1', 'epads/a_p1_bidding_document.pdf'),
          file: 'epads/a_p1_bidding_document.pdf',
        },
      ],
      ['epads/unlisted.pdf'],
    );
    const tenantName = uniqueTenant();

    await expect(importCorpus(handle.db, { corpusRoot: root, tenantName })).rejects.toThrow(
      /no manifest row[\s\S]*unlisted\.pdf/,
    );

    const created = await handle.db.select().from(tenants).where(eq(tenants.name, tenantName));
    expect(created).toEqual([]);
  });

  it('rejects a byte-identical copy and leaves no tender behind for it', async () => {
    // Two differently named files, same bytes, both following the naming convention,
    // so neither is caught by the test_ or blank tender_id rules.
    const shared = '%PDF-1.4 identical bytes';
    const root = await makeCorpus([
      {
        row: row('a_p1', 'epads/a_p1_bidding_document.pdf'),
        file: 'epads/a_p1_bidding_document.pdf',
        bytes: shared,
      },
      {
        row: row('z_p9', 'epads/z_p9_bidding_document.pdf'),
        file: 'epads/z_p9_bidding_document.pdf',
        bytes: shared,
      },
    ]);
    const tenantName = uniqueTenant();

    const report = await importCorpus(handle.db, { corpusRoot: root, tenantName });

    expect(report.documentsInserted).toBe(1);
    expect(report.duplicatesRejected).toHaveLength(1);
    expect(report.duplicatesRejected[0]).toMatchObject({
      filePath: 'epads/z_p9_bidding_document.pdf',
      keptFilePath: 'epads/a_p1_bidding_document.pdf',
    });

    // The rejected row's tender must have rolled back with its document.
    const tenantRow = await handle.db.select().from(tenants).where(eq(tenants.name, tenantName));
    const tenantId = tenantRow[0]?.id ?? '';
    const storedTenders = await handle.db
      .select()
      .from(tenders)
      .where(eq(tenders.tenantId, tenantId));

    expect(storedTenders.map((t) => t.reference)).toEqual(['a_p1']);
  });

  it('is idempotent: a second run updates and inserts nothing', async () => {
    const root = await makeCorpus([
      {
        row: row('a_p1', 'epads/a_p1_bidding_document.pdf'),
        file: 'epads/a_p1_bidding_document.pdf',
      },
    ]);
    const tenantName = uniqueTenant();

    await importCorpus(handle.db, { corpusRoot: root, tenantName });
    const second = await importCorpus(handle.db, { corpusRoot: root, tenantName });

    expect(second.documentsInserted).toBe(0);
    expect(second.documentsUpdated).toBe(1);
    expect(second.tendersCreated).toBe(0);

    const tenantRow = await handle.db.select().from(tenants).where(eq(tenants.name, tenantName));
    const stored = await handle.db
      .select()
      .from(documents)
      .where(eq(documents.tenantId, tenantRow[0]?.id ?? ''));
    expect(stored).toHaveLength(1);
  });

  it('reports rows skipped by the manifest rules', async () => {
    const root = await makeCorpus([
      {
        row: row('a_p1', 'epads/a_p1_bidding_document.pdf'),
        file: 'epads/a_p1_bidding_document.pdf',
      },
      {
        row: row('test_p9', 'epads/test_p9_bidding_document.pdf'),
        file: 'epads/test_p9_bidding_document.pdf',
      },
      { row: row('', 'epads/nameless.pdf'), file: 'epads/nameless.pdf' },
    ]);
    const tenantName = uniqueTenant();

    const report = await importCorpus(handle.db, { corpusRoot: root, tenantName });

    expect(report.documentsInserted).toBe(1);
    expect(report.skipped.map((s) => s.reason).sort()).toEqual(['no_tender_id', 'test_artefact']);
  });
});
