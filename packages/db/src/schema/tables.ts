import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { docTypeEnum, extractionMethodEnum } from './enums.js';

/**
 * Tenancy lands with the schema rather than with F012, because adding a tenant key to
 * every table later means a migration, a backfill and rewriting every query. F012 adds
 * the row-level security policies that enforce it; these columns only carry it.
 */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One procurement. Its documents are grouped here so amendments can be resolved. */
export const tenders = pgTable(
  'tenders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // The manifest's tender_id, e.g. kphealth_bemonc-516119. Stable across documents.
    reference: text('reference').notNull(),
    agency: text('agency').notNull(),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tenders_tenant_reference_idx').on(table.tenantId, table.reference)],
);

/** One file. A tender has one or more, and the latest by published_on wins (D004). */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    // Path relative to corpus/, e.g. kphealth/kphealth_bemonc-516119_addendum-2.pdf
    filePath: text('file_path').notNull(),
    docType: docTypeEnum('doc_type').notNull(),
    // The manifest's free-text version label, kept for provenance only. Eleven
    // inconsistent values exist (current, original, corr1, corr1-revised, prebid...),
    // and no sort over them is meaningful. Never order by this column.
    versionLabel: text('version_label'),
    // The only ordering key for amendment resolution.
    publishedOn: date('published_on').notNull(),
    sourceUrl: text('source_url'),
    // Rejects byte-identical duplicates at the database rather than by convention.
    // epads/bidding-document.pdf is the same file as ngc_p96607; importing both would
    // chunk one passage twice and make retrieval look corroborated when it is not.
    contentSha256: text('content_sha256').notNull(),
    // The hash the pages were extracted from. Null means never extracted; a value
    // different from contentSha256 means the file changed and the pages are stale.
    // Without it, extraction cannot tell "already done" from "done against old bytes".
    extractedSha256: text('extracted_sha256'),
    // Which extraction logic produced the pages. Re-extraction happens when this differs
    // from the current version, so a change to extraction reaches documents whose bytes
    // did not change.
    extractorVersion: text('extractor_version'),
    // What the current chunks were built from: extracted bytes, extractor version and
    // chunker version. Chunks are rebuilt only when this changes. From F006 on,
    // rebuilding chunks means paying to embed them again, so rebuilding on every run
    // would cost money for nothing.
    chunkFingerprint: text('chunk_fingerprint'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('documents_tenant_sha_idx').on(table.tenantId, table.contentSha256),
    uniqueIndex('documents_tenant_path_idx').on(table.tenantId, table.filePath),
    // Amendment resolution reads a tender's documents newest first.
    index('documents_tender_published_idx').on(table.tenderId, table.publishedOn),
  ],
);

/**
 * One physical PDF page, 1-based.
 *
 * Physical, never the printed footer number: EPADS documents carry about twelve
 * near-empty form pages, so the two disagree, and a citation that opens the wrong page
 * is indistinguishable from a wrong answer (D003).
 */
export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    text: text('text'),
    extractionMethod: extractionMethodEnum('extraction_method'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pages_document_number_idx').on(table.documentId, table.pageNumber),
    check('pages_page_number_positive', sql`${table.pageNumber} >= 1`),
  ],
);

/**
 * Length of every stored embedding: text-embedding-3-small's native size (F006). It is
 * fixed in the column type, so a model with another size needs a migration, and the
 * embedding job checks the configured size against the live column before any paid call.
 * Under 2000, the most an HNSW index on `vector` supports.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * A retrievable piece of text from one physical page, with its embedding once F006's
 * job has run.
 */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // Always equal: a chunk never crosses a page (D021). Kept as a range so citations
    // read the same whether or not that rule is ever relaxed.
    firstPage: integer('first_page').notNull(),
    lastPage: integer('last_page').notNull(),
    sectionHeading: text('section_heading'),
    text: text('text').notNull(),
    // Exact, in the embedding model's tokenizer.
    tokenCount: integer('token_count'),
    // Null until embedded. A rebuilt chunk is a new row, so it starts null and is paid
    // for once; an unchanged chunk keeps its vector (D021).
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    // Which model made the vector. A chunk whose model differs from the configured one
    // is embedded again, so switching models never leaves a mix that cannot be compared.
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chunks_document_idx').on(table.documentId),
    // Cosine distance, since OpenAI embeddings are normalised and compared by angle. HNSW
    // rather than IVFFlat: it builds incrementally and needs no training data or tuning.
    index('chunks_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    check('chunks_first_page_positive', sql`${table.firstPage} >= 1`),
    check('chunks_page_range_ordered', sql`${table.lastPage} >= ${table.firstPage}`),
  ],
);
