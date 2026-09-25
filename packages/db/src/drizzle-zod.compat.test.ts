import { createInsertSchema } from 'drizzle-zod';
import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

/**
 * Compatibility check deferred to F002 by the F001 spec.
 *
 * D013 picked Zod 4, and drizzle-zod is the bridge between the schema and every
 * validated boundary that reads from it. This proves the two agree before the real
 * tables are written against them.
 */
const probe = pgTable('compat_probe', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  pageNumber: integer('page_number').notNull(),
});

describe('drizzle-zod with Zod 4', () => {
  const insertSchema = createInsertSchema(probe);

  it('accepts a well formed row', () => {
    const row = {
      id: '6f1c9e1e-0b9a-4f3a-9a0d-9b1f2c3d4e5f',
      name: 'bidding document',
      pageNumber: 12,
    };

    expect(insertSchema.parse(row)).toMatchObject(row);
  });

  it('rejects a row missing a not-null column', () => {
    const result = insertSchema.safeParse({
      id: '6f1c9e1e-0b9a-4f3a-9a0d-9b1f2c3d4e5f',
      pageNumber: 12,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a wrong column type rather than coercing it', () => {
    const result = insertSchema.safeParse({
      id: '6f1c9e1e-0b9a-4f3a-9a0d-9b1f2c3d4e5f',
      name: 'bidding document',
      pageNumber: 'twelve',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed uuid, proving column types carry their constraints', () => {
    const result = insertSchema.safeParse({
      id: 'not-a-uuid',
      name: 'bidding document',
      pageNumber: 12,
    });

    expect(result.success).toBe(false);
  });
});
