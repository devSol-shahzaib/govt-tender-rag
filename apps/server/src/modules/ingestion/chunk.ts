/**
 * Splits extracted pages into retrievable chunks.
 *
 * Pure functions: pages in, chunks out, no database. Every chunk comes from exactly one
 * physical page, so every citation points at one page (D003).
 */

/**
 * Identifies the chunking logic. Part of each document's chunk fingerprint, so bumping
 * it rebuilds every document's chunks on the next run. From F006 on, rebuilding chunks
 * means paying to embed them again, so bump it only when chunking really changed.
 */
export const CHUNKER_VERSION = 'structure-v2';

/**
 * Sizes in tokens of the embedding model's tokenizer. A chunk keeps growing while it is under the target and
 * never grows past the maximum. These are starting guesses, sized so a median page
 * (about 410 tokens) becomes one or two chunks; Module 2's evals are where they get
 * tuned against retrieval quality.
 */
export const TARGET_TOKENS = 250;
export const MAX_TOKENS = 400;
/**
 * A chunk smaller than this is merged into a neighbour on the same page. Fragments
 * like "B. Preparation of Proposals / BDS Clause Number 3 / ITB Number 4.1", left at
 * the bottom of a page when the clause's value is on the next one, answer nothing on
 * their own and crowd real matches out of search results.
 */
export const MIN_TOKENS = 40;

/**
 * Counts tokens the way the embedding model will. Passed in rather than imported, so the
 * chunker stays pure and does not decide which model it is sizing for.
 */
export type CountTokens = (text: string) => number;

/**
 * The footer EPADS prints on 3412 pages, carrying the printed page number that D003
 * says citations must never show. Matched in its one exact form, and only that form:
 * 35 pages contain the tender sentence "available on e-Pak Acquisition and Disposal
 * System (EPADS)", and a looser match would delete it. 3322 of the footers share a line
 * with the page's last line of content, so the match works inside a line, not on whole
 * lines.
 */
const EPADS_FOOTER =
  /[ \t]*e-Pak Acquisition and Disposal System \(EPADS\) generated document \| © \d{4} Page \d+ of \d+[ \t]*/g;

/** Removes the EPADS footer and blank lines. The stored page keeps both; only chunk text changes. */
export function stripEpadsFooter(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(EPADS_FOOTER, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

const BDS_CLAUSE = /^BDS Clause Number\b/i;
/** "A. General", "B. Contents of RFP". */
const LETTERED_SECTION = /^[A-Z]\.\s+[A-Z][^.:;]{1,60}$/;
/**
 * "1. The Directorate General...", "17.1 The amount of bid security". Requires text
 * after the number, so the bare "1" and "1.1" cells of a BDS table are not boundaries.
 */
const NUMBERED_ITEM = /^\d{1,3}(\.\d{1,3})*\.?\s+[A-Za-z(“"]/;
const ENDS_LIKE_SENTENCE = /[.,;:]$/;

function wordsOf(line: string): string[] {
  return line.split(/\s+/).filter((w) => w !== '');
}

/** "TABLE OF CONTENTS", "CORRIGENDUM", "PROCUREMENT NOTICE". */
function isAllCapsHeading(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  const words = wordsOf(line).length;
  return (
    letters.length >= 4 &&
    letters === letters.toUpperCase() &&
    words >= 1 &&
    words <= 12 &&
    line.length <= 90 &&
    !ENDS_LIKE_SENTENCE.test(line)
  );
}

/**
 * Title-like: most longer words capitalised. Separates "Special Conditions of Contract"
 * from "The BOQ is attached in the annuxures along with the Tender Document", a
 * one-line page that is content and must not be mistaken for a heading and dropped.
 */
function isTitleCase(line: string): boolean {
  if (line.length > 90 || ENDS_LIKE_SENTENCE.test(line)) return false;

  const significant = wordsOf(line)
    .map((w) => w.replace(/^[(“"]+/, ''))
    .filter((w) => w.length > 3);
  if (significant.length === 0) return false;

  const capitalised = significant.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalised / significant.length >= 0.6;
}

export interface PageText {
  /** Physical, 1-based. */
  readonly pageNumber: number;
  readonly text: string;
}

export interface Chunk {
  /** One page per chunk, always. Stored as both first_page and last_page. */
  readonly pageNumber: number;
  readonly sectionHeading: string | null;
  readonly text: string;
  readonly tokenCount: number;
}

export interface OversizeLine {
  readonly pageNumber: number;
  readonly tokenCount: number;
  readonly preview: string;
}

export interface ChunkedDocument {
  readonly chunks: readonly Chunk[];
  /** Pages that held only a heading. They label the pages after them instead. */
  readonly headingOnlyPages: readonly number[];
  /** Single sentences over the cap that could not be split. Kept whole, reported. */
  readonly oversize: readonly OversizeLine[];
}

/**
 * Folds chunks under MIN_TOKENS into a neighbour on the same page, forward if it fits
 * and otherwise backward, never past MAX_TOKENS. The merged chunk keeps the heading of
 * whichever part holds more text. A page whose only content is small stays as it is:
 * merging across pages would break the one-page-per-chunk rule.
 */
function mergeSmallChunks(pageChunks: Chunk[], countTokens: CountTokens): Chunk[] {
  const merged = [...pageChunks];
  let index = 0;

  while (index < merged.length) {
    const chunk = merged[index];
    if (chunk === undefined || chunk.tokenCount >= MIN_TOKENS || merged.length === 1) {
      index += 1;
      continue;
    }

    const combine = (first: Chunk, second: Chunk): Chunk => {
      const text = `${first.text}\n${second.text}`;
      return {
        pageNumber: first.pageNumber,
        sectionHeading:
          first.tokenCount >= second.tokenCount ? first.sectionHeading : second.sectionHeading,
        text,
        tokenCount: countTokens(text),
      };
    };

    const next = merged[index + 1];
    const previous = merged[index - 1];

    // Measured on the joined text, not by adding the two counts: the joining newline is
    // a token of its own and can push a sum of exactly MAX_TOKENS one over.
    const forward = next === undefined ? undefined : combine(chunk, next);
    const backward = previous === undefined ? undefined : combine(previous, chunk);

    if (forward !== undefined && forward.tokenCount <= MAX_TOKENS) {
      merged.splice(index, 2, forward);
    } else if (backward !== undefined && backward.tokenCount <= MAX_TOKENS) {
      merged.splice(index - 1, 2, backward);
      index -= 1;
    } else {
      index += 1;
    }
  }

  return merged;
}

interface Segment {
  readonly lines: string[];
  readonly heading: string | null;
}

interface HeadingContext {
  section: string | null;
  subsection: string | null;
}

function headingLabel(context: HeadingContext): string | null {
  const parts = [context.section, context.subsection].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(' > ');
}

/** Splits text that is too long at sentence ends. A sentence longer than the cap stays whole. */
function splitLongLine(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z0-9(“"])/).filter((s) => s !== '');
}

/**
 * Chunks one document's pages, in page order.
 *
 * Headings carry across pages: a page that starts mid-section still gets that
 * section's heading. The text never crosses a page.
 */
export function chunkDocument(
  pages: readonly PageText[],
  countTokens: CountTokens,
): ChunkedDocument {
  const chunks: Chunk[] = [];
  const headingOnlyPages: number[] = [];
  const oversize: OversizeLine[] = [];
  const context: HeadingContext = { section: null, subsection: null };

  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const lines = stripEpadsFooter(page.text)
      .split('\n')
      .filter((l) => l !== '');
    if (lines.length === 0) continue;

    // A divider page: once the footer is gone, only a title is left. It becomes the
    // heading for what follows rather than a chunk that answers nothing.
    const onlyLine = lines.length === 1 ? lines[0] : undefined;
    if (onlyLine !== undefined && (isAllCapsHeading(onlyLine) || isTitleCase(onlyLine))) {
      context.section = onlyLine;
      context.subsection = null;
      headingOnlyPages.push(page.pageNumber);
      continue;
    }

    const segments: Segment[] = [];
    let current: Segment | null = null;

    lines.forEach((line, index) => {
      // Numbered clauses and lettered subsections are never top-level sections. Without
      // this, "12. Termination of Contract for Failure to Become Effective", sitting on
      // the first line of a page, labelled the next 385 chunks.
      const isNumbered = NUMBERED_ITEM.test(line);
      const isSubsection = LETTERED_SECTION.test(line);
      const isSection =
        !isNumbered &&
        !isSubsection &&
        (isAllCapsHeading(line) || (index === 0 && isTitleCase(line) && line.length <= 60));

      if (isSection) {
        context.section = line;
        context.subsection = null;
      } else if (isSubsection) {
        context.subsection = line;
      }

      const startsSegment =
        current === null || isSection || isSubsection || BDS_CLAUSE.test(line) || isNumbered;

      if (startsSegment) {
        current = { lines: [line], heading: headingLabel(context) };
        segments.push(current);
      } else {
        current?.lines.push(line);
      }
    });

    const pageChunks: Chunk[] = [];
    let open: { lines: string[]; heading: string | null } | null = null;

    const flush = () => {
      if (open === null) return;
      const text = open.lines.join('\n');
      pageChunks.push({
        pageNumber: page.pageNumber,
        sectionHeading: open.heading,
        text,
        tokenCount: countTokens(text),
      });
      open = null;
    };

    for (const segment of segments) {
      const segmentText = segment.lines.join('\n');
      const segmentTokens = countTokens(segmentText);

      // A segment too big for one chunk is split at line ends, then at sentence ends.
      if (segmentTokens > MAX_TOKENS) {
        flush();
        let piece: string[] = [];
        const emit = () => {
          if (piece.length === 0) return;
          const text = piece.join('\n');
          pageChunks.push({
            pageNumber: page.pageNumber,
            sectionHeading: segment.heading,
            text,
            tokenCount: countTokens(text),
          });
          piece = [];
        };

        for (const line of segment.lines) {
          const parts = countTokens(line) > MAX_TOKENS ? splitLongLine(line) : [line];
          for (const part of parts) {
            if (countTokens(part) > MAX_TOKENS) {
              oversize.push({
                pageNumber: page.pageNumber,
                tokenCount: countTokens(part),
                preview: part.slice(0, 80),
              });
            }
            if (piece.length > 0 && countTokens([...piece, part].join('\n')) > MAX_TOKENS) {
              emit();
            }
            piece.push(part);
          }
        }
        emit();
        continue;
      }

      // Small segments are packed together while under the target, never past the
      // maximum, and never across a change of heading.
      const fits =
        open !== null &&
        open.heading === segment.heading &&
        countTokens(open.lines.join('\n')) < TARGET_TOKENS &&
        countTokens([...open.lines, ...segment.lines].join('\n')) <= MAX_TOKENS;

      if (fits && open !== null) {
        open.lines.push(...segment.lines);
      } else {
        flush();
        open = { lines: [...segment.lines], heading: segment.heading };
      }
    }
    flush();
    chunks.push(...mergeSmallChunks(pageChunks, countTokens));
  }

  return { chunks, headingOnlyPages, oversize };
}
