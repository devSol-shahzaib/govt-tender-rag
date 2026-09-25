import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../client.js';
import { chunks, documents, pages, tenants, tenders } from './index.js';

const connectionString = process.env.TEST_DATABASE_URL;

/**
 * These need a real database. A mocked one would assert that Drizzle builds the SQL we
 * expect, not that Postgres accepts it, and every constraint under test here is
 * enforced by Postgres rather than by the application.
 *
 * Every test runs inside a transaction that is rolled back, so the database is left
 * exactly as it was found and no truncate is ever needed.
 */
const describeWithDb = connectionString === undefined ? describe.skip : describe;

if (connectionString === undefined) {
  console.warn('TEST_DATABASE_URL is not set, skipping schema tests. See packages/db/.env.example');
}

describeWithDb('tender schema', () => {
  // Checked above; describe.skip means the body never runs when it is undefined.
  const url = connectionString ?? '';
  let handle: ReturnType<typeof createDatabase>;

  beforeAll(() => {
    handle = createDatabase(url, { max: 2 });
  });

  afterAll(async () => {
    await handle.close();
  });

  /** Runs body inside a transaction and always rolls it back. */
  async function inRollback(
    body: (tx: Parameters<Parameters<typeof handle.db.transaction>[0]>[0]) => Promise<void>,
  ) {
    const sentinel = new Error('rollback');

    try {
      await handle.db.transaction(async (tx) => {
        await body(tx);
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  async function seedTenant(
    tx: Parameters<Parameters<typeof handle.db.transaction>[0]>[0],
    name = 'test tenant',
  ) {
    const [tenant] = await tx.insert(tenants).values({ name }).returning();
    if (tenant === undefined) throw new Error('tenant insert returned nothing');
    return tenant;
  }

  it('round-trips a tender, document, page and chunk', async () => {
    await inRollback(async (tx) => {
      const tenant = await seedTenant(tx);

      const [tender] = await tx
        .insert(tenders)
        .values({
          tenantId: tenant.id,
          reference: 'kphealth_bemonc-516119',
          agency: 'KP Health Department',
          title: 'BEmONC equipment',
        })
        .returning();
      if (tender === undefined) throw new Error('tender insert returned nothing');

      const [document] = await tx
        .insert(documents)
        .values({
          tenantId: tenant.id,
          tenderId: tender.id,
          filePath: 'kphealth/kphealth_bemonc-516119_addendum-2.pdf',
          docType: 'addendum',
          versionLabel: 'addendum2',
          publishedOn: '2026-05-18',
          contentSha256: 'a'.repeat(64),
        })
        .returning();
      if (document === undefined) throw new Error('document insert returned nothing');

      await tx.insert(pages).values({
        tenantId: tenant.id,
        documentId: document.id,
        pageNumber: 1,
        text: 'Bid security shall be PKR 500,000.',
        extractionMethod: 'text_layer',
      });

      await tx.insert(chunks).values({
        tenantId: tenant.id,
        documentId: document.id,
        firstPage: 1,
        lastPage: 2,
        sectionHeading: 'Bid Data Sheet',
        text: 'Bid security shall be PKR 500,000.',
        tokenCount: 12,
      });

      const storedPages = await tx.select().from(pages).where(eq(pages.documentId, document.id));
      const storedChunks = await tx.select().from(chunks).where(eq(chunks.documentId, document.id));

      expect(storedPages).toHaveLength(1);
      expect(storedPages[0]?.pageNumber).toBe(1);
      expect(storedChunks[0]?.lastPage).toBe(2);
      // date columns come back as strings, not Date, which matters to amendment sorting.
      expect(document.publishedOn).toBe('2026-05-18');
    });
  });

  it('rejects a second document with the same content hash', async () => {
    await inRollback(async (tx) => {
      const tenant = await seedTenant(tx);
      const [tender] = await tx
        .insert(tenders)
        .values({
          tenantId: tenant.id,
          reference: 'ngc_p96607',
          agency: 'NGC',
          title: 'Route survey',
        })
        .returning();
      if (tender === undefined) throw new Error('tender insert returned nothing');

      const sha = 'b'.repeat(64);
      const base = {
        tenantId: tenant.id,
        tenderId: tender.id,
        docType: 'bidding_document' as const,
        publishedOn: '2026-08-24',
        contentSha256: sha,
      };

      await tx
        .insert(documents)
        .values({ ...base, filePath: 'epads/ngc_p96607_bidding_document.pdf' });

      // The real duplicate: same bytes, different filename.
      await expect(
        tx.insert(documents).values({ ...base, filePath: 'epads/bidding-document.pdf' }),
      ).rejects.toThrow();
    });
  });

  it('allows the same content hash under a different tenant', async () => {
    await inRollback(async (tx) => {
      const first = await seedTenant(tx, 'tenant one');
      const second = await seedTenant(tx, 'tenant two');
      const sha = 'c'.repeat(64);

      for (const tenant of [first, second]) {
        const [tender] = await tx
          .insert(tenders)
          .values({
            tenantId: tenant.id,
            reference: 'shared_ref',
            agency: 'Agency',
            title: 'Shared',
          })
          .returning();
        if (tender === undefined) throw new Error('tender insert returned nothing');

        await tx.insert(documents).values({
          tenantId: tenant.id,
          tenderId: tender.id,
          filePath: 'epads/same.pdf',
          docType: 'bidding_document',
          publishedOn: '2026-08-24',
          contentSha256: sha,
        });
      }

      const stored = await tx.select().from(documents).where(eq(documents.contentSha256, sha));
      expect(stored).toHaveLength(2);
    });
  });

  it('rejects page number zero, because citations are 1-based physical pages', async () => {
    await inRollback(async (tx) => {
      const tenant = await seedTenant(tx);
      const [tender] = await tx
        .insert(tenders)
        .values({ tenantId: tenant.id, reference: 'ref', agency: 'Agency', title: 'Title' })
        .returning();
      if (tender === undefined) throw new Error('tender insert returned nothing');

      const [document] = await tx
        .insert(documents)
        .values({
          tenantId: tenant.id,
          tenderId: tender.id,
          filePath: 'epads/zero.pdf',
          docType: 'bidding_document',
          publishedOn: '2026-08-24',
          contentSha256: 'd'.repeat(64),
        })
        .returning();
      if (document === undefined) throw new Error('document insert returned nothing');

      await expect(
        tx.insert(pages).values({ tenantId: tenant.id, documentId: document.id, pageNumber: 0 }),
      ).rejects.toThrow();
    });
  });

  it('rejects a chunk whose page range runs backwards', async () => {
    await inRollback(async (tx) => {
      const tenant = await seedTenant(tx);
      const [tender] = await tx
        .insert(tenders)
        .values({ tenantId: tenant.id, reference: 'ref2', agency: 'Agency', title: 'Title' })
        .returning();
      if (tender === undefined) throw new Error('tender insert returned nothing');

      const [document] = await tx
        .insert(documents)
        .values({
          tenantId: tenant.id,
          tenderId: tender.id,
          filePath: 'epads/range.pdf',
          docType: 'bidding_document',
          publishedOn: '2026-08-24',
          contentSha256: 'e'.repeat(64),
        })
        .returning();
      if (document === undefined) throw new Error('document insert returned nothing');

      await expect(
        tx.insert(chunks).values({
          tenantId: tenant.id,
          documentId: document.id,
          firstPage: 9,
          lastPage: 4,
          text: 'backwards',
        }),
      ).rejects.toThrow();
    });
  });

  it('leaves nothing behind, so the suite can run repeatedly', async () => {
    const client = postgres(url, { max: 1 });

    try {
      const [row] = await client<{ count: string }[]>`SELECT count(*)::text AS count FROM tenants`;
      expect(row?.count).toBe('0');
    } finally {
      await client.end();
    }
  });
});
