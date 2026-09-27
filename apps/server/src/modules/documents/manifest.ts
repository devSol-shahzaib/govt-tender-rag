import { parse } from 'csv-parse/sync';
import { z } from 'zod';

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const MONTH_DAY_YEAR = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/;
const DAY_MONTH_YEAR = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/;

function assembleDate(year: string, monthName: string, day: string, original: string): string {
  const month = MONTHS[monthName.toLowerCase()];

  if (month === undefined) {
    throw new Error(`Unrecognised month in listing date: ${original}`);
  }

  const yearNumber = Number(year);
  const dayNumber = Number(day);

  // Date.UTC is safe where `new Date(string)` is not: it takes numbers and applies no
  // local offset. It is used only to reject dates that do not exist, such as 31 April.
  const asUtc = new Date(Date.UTC(yearNumber, month - 1, dayNumber));

  if (asUtc.getUTCMonth() !== month - 1 || asUtc.getUTCDate() !== dayNumber) {
    throw new Error(`Listing date is not a real calendar date: ${original}`);
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
}

/**
 * Parses a manifest listing date into a YYYY-MM-DD string.
 *
 * The manifest carries two formats in one column, split by source: EPADS writes
 * "August 24, 2026" and KP Health writes "24-February-2026". Both parse through
 * `new Date()`, and both come out a day early, because the string is read as local
 * midnight and then converted to UTC. The shift is silent and uniform, which makes it
 * exactly the kind of error that survives review.
 *
 * published_on is the only key that orders a tender's amendments (D004), so this
 * builds the string directly and never constructs a Date from text.
 */
export function parseListingDate(value: string): string {
  const trimmed = value.trim();

  const monthFirst = MONTH_DAY_YEAR.exec(trimmed);
  if (monthFirst?.[1] !== undefined && monthFirst[2] !== undefined && monthFirst[3] !== undefined) {
    return assembleDate(monthFirst[3], monthFirst[1], monthFirst[2], trimmed);
  }

  const dayFirst = DAY_MONTH_YEAR.exec(trimmed);
  if (dayFirst?.[1] !== undefined && dayFirst[2] !== undefined && dayFirst[3] !== undefined) {
    return assembleDate(dayFirst[3], dayFirst[2], dayFirst[1], trimmed);
  }

  throw new Error(
    `Unrecognised listing date format: ${JSON.stringify(trimmed)}. ` +
      `Expected "August 24, 2026" or "24-February-2026".`,
  );
}

export const DOC_TYPES = [
  'bidding_document',
  'corrigendum',
  'addendum',
  'revised',
  'prebid_minutes',
  'boq',
] as const;

const manifestRowSchema = z.object({
  tender_id: z.string(),
  file: z.string().min(1),
  doc_type: z.enum(DOC_TYPES),
  version: z.string(),
  agency: z.string().min(1),
  title: z.string().min(1),
  url: z.string(),
  date_on_listing: z.string().min(1),
});

export interface ManifestEntry {
  readonly tenderReference: string;
  /** Path relative to corpus/, as written in the manifest. */
  readonly filePath: string;
  readonly docType: (typeof DOC_TYPES)[number];
  readonly versionLabel: string | null;
  readonly publishedOn: string;
  readonly sourceUrl: string | null;
  readonly agency: string;
  readonly title: string;
}

export type SkipReason = 'test_artefact' | 'no_tender_id';

export interface SkippedRow {
  readonly filePath: string;
  readonly reason: SkipReason;
  readonly detail: string;
}

export interface ParsedManifest {
  readonly entries: readonly ManifestEntry[];
  readonly skipped: readonly SkippedRow[];
}

/**
 * True when the file is named <tender_id>_<something>.pdf.
 *
 * Used to order a hash group so the canonically named copy is imported first. The
 * corpus holds three byte-identical files, and only one can pass the unique content
 * hash, so which one survives must not depend on CSV row order.
 */
export function followsNamingConvention(entry: ManifestEntry): boolean {
  if (entry.tenderReference === '') return false;

  const fileName = entry.filePath.split('/').at(-1) ?? '';
  return fileName.startsWith(`${entry.tenderReference}_`);
}

/**
 * Parses the manifest CSV into entries to import, and rows deliberately left out.
 *
 * Two rows are dropped before the database is touched. A tender_id beginning with
 * `test_` marks a collection artefact rather than a real procurement: the corpus holds
 * one, a second download of procurement 96607 saved under a test name. A blank
 * tender_id cannot be imported at all, because a document has nowhere to attach
 * without a tender.
 *
 * Both happen to be byte-identical copies of ngc_p96607, so the unique content hash
 * would also have caught them. It stays as the general net for duplicates these two
 * rules do not describe.
 */
export function parseManifest(csvText: string): ParsedManifest {
  const raw: unknown = parse(csvText, { columns: true, skip_empty_lines: true, bom: true });

  if (!Array.isArray(raw)) {
    throw new Error('Manifest did not parse into rows');
  }

  const entries = raw.map((row, index) => {
    const parsed = manifestRowSchema.safeParse(row);

    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      // Row 1 is the header, so a reader counting lines in a spreadsheet gets index + 2.
      throw new Error(`Manifest row ${String(index + 2)} is invalid: ${problems}`);
    }

    const data = parsed.data;

    let publishedOn: string;
    try {
      publishedOn = parseListingDate(data.date_on_listing);
    } catch (error) {
      throw new Error(
        `Manifest row ${String(index + 2)} (${data.file}): ${(error as Error).message}`,
      );
    }

    return {
      tenderReference: data.tender_id.trim(),
      filePath: data.file.trim(),
      docType: data.doc_type,
      versionLabel: data.version.trim() === '' ? null : data.version.trim(),
      publishedOn,
      sourceUrl: data.url.trim() === '' ? null : data.url.trim(),
      agency: data.agency.trim(),
      title: data.title.trim(),
    } satisfies ManifestEntry;
  });

  const skipped: SkippedRow[] = [];
  const keep: ManifestEntry[] = [];

  for (const entry of entries) {
    if (entry.tenderReference.startsWith('test_')) {
      skipped.push({
        filePath: entry.filePath,
        reason: 'test_artefact',
        detail: `tender_id ${entry.tenderReference} marks a collection artefact, not a procurement`,
      });
      continue;
    }

    if (entry.tenderReference === '') {
      skipped.push({
        filePath: entry.filePath,
        reason: 'no_tender_id',
        detail: 'row has no tender_id, so the document has no tender to attach to',
      });
      continue;
    }

    keep.push(entry);
  }

  keep.sort((a, b) => {
    const aNamed = followsNamingConvention(a) ? 0 : 1;
    const bNamed = followsNamingConvention(b) ? 0 : 1;
    if (aNamed !== bNamed) return aNamed - bNamed;
    return a.filePath.localeCompare(b.filePath);
  });

  return { entries: keep, skipped };
}
