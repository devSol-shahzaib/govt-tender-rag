import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Document kinds present in the corpus manifest.
 *
 * These describe what a document IS, not when it arrived. They must never be used to
 * order a tender's documents: kphealth_antimalaria-2025-26 contains a `revised`
 * document dated 16-January-2026 and a `bidding_document` dated 06-February-2026, so
 * the one labelled revised is the older of the two. Ordering is by
 * `documents.published_on` alone (D004).
 */
export const docTypeEnum = pgEnum('doc_type', [
  'bidding_document',
  'corrigendum',
  'addendum',
  'revised',
  'prebid_minutes',
  'boq',
]);

/**
 * How a page's text was obtained. Recorded per page because D005 sends only pages
 * without a text layer to a vision model, and a wrong answer traced to a page needs
 * to show whether a human-readable layer or OCR produced it.
 */
export const extractionMethodEnum = pgEnum('extraction_method', ['text_layer', 'ocr']);
