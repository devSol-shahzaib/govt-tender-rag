import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTokenCounter } from '@tender/core';
import { describe, expect, it } from 'vitest';
import {
  chunkDocument,
  MAX_TOKENS,
  stripEpadsFooter,
  type ChunkedDocument,
  type PageText,
} from './chunk.js';
import { extractPageText } from './extract.js';

const { count } = createTokenCounter('text-embedding-3-small');

/** Chunks with the real tokenizer, as production does. */
function chunk(pages: readonly PageText[]): ChunkedDocument {
  return chunkDocument(pages, count);
}

/** Space-separated words with no sentence end, so the chunker cannot split it. */
function unsplittableLine(tokens: number): string {
  return Array.from({ length: tokens }, () => 'item').join(' ');
}

const corpusRoot = fileURLToPath(new URL('../../../../../corpus/', import.meta.url));

async function pagesOf(relative: string): Promise<PageText[]> {
  const bytes = new Uint8Array(await readFile(path.join(corpusRoot, relative)));
  const pages = await extractPageText(bytes);
  return pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text }));
}

const FOOTER =
  'e-Pak Acquisition and Disposal System (EPADS) generated document | © 2026 Page 27 of 80';

describe('stripEpadsFooter', () => {
  it('removes a footer that shares a line with content, keeping the content', () => {
    // 3322 of the corpus's footers sit on the page's last line of content.
    expect(stripEpadsFooter(`Special Conditions of Contract ${FOOTER}`)).toBe(
      'Special Conditions of Contract',
    );
  });

  it('removes a footer that is a line of its own', () => {
    expect(stripEpadsFooter(`Bid security is 2%\n${FOOTER}`)).toBe('Bid security is 2%');
  });

  it('never touches tender text that mentions the same system', () => {
    // 35 pages carry this sentence. A looser match would delete it.
    const body =
      'specifications and requirements etc. are available on e-Pak Acquisition and Disposal\nSystem (EPADS)';
    expect(stripEpadsFooter(body)).toBe(body);
  });
});

describe('chunkDocument', () => {
  it('keeps every chunk on a single page', () => {
    const { chunks } = chunk([
      { pageNumber: 4, text: '1. First clause about bids.\n2. Second clause.' },
      { pageNumber: 5, text: '3. Third clause on another page.' },
    ]);

    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([4, 5]));
    expect(chunks.every((c) => c.text.length > 0)).toBe(true);
  });

  it('turns a divider page into a heading for the pages after it, not a chunk', () => {
    const { chunks, headingOnlyPages } = chunk([
      { pageNumber: 45, text: `Special Conditions of Contract ${FOOTER}` },
      { pageNumber: 46, text: '1. The contractor shall deliver within 30 days.' },
    ]);

    expect(headingOnlyPages).toEqual([45]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sectionHeading).toBe('Special Conditions of Contract');
  });

  it('does not mistake a one-line content page for a heading', () => {
    // A real one-line page. Treating it as a heading would drop the fact that the BOQ
    // is in the annexures.
    const { chunks, headingOnlyPages } = chunk([
      {
        pageNumber: 28,
        text: `The BOQ is attached in the annuxures along with the Tender Document ${FOOTER}`,
      },
    ]);

    expect(headingOnlyPages).toEqual([]);
    expect(chunks[0]?.text).toBe(
      'The BOQ is attached in the annuxures along with the Tender Document',
    );
  });

  it('never lets the printed page number into chunk text', () => {
    const { chunks } = chunk([{ pageNumber: 30, text: `1. Bids open on 4 March.\n${FOOTER}` }]);

    expect(chunks.some((c) => c.text.includes('Page 27 of 80'))).toBe(false);
  });

  it('keeps chunks under the cap, reporting only a sentence that cannot be split', () => {
    const sentence = 'The bidder shall comply with every clause of this document. ';
    const longLine = sentence.repeat(60).trim();
    const unsplittable = unsplittableLine(MAX_TOKENS + 100);

    const { chunks, oversize } = chunk([{ pageNumber: 1, text: `${longLine}\n${unsplittable}` }]);

    const tooBig = chunks.filter((c) => c.tokenCount > MAX_TOKENS);
    expect(tooBig).toHaveLength(1);
    expect(tooBig[0]?.text).toBe(unsplittable);
    expect(oversize).toHaveLength(1);
    expect(oversize[0]?.pageNumber).toBe(1);
  });

  it('never lets a numbered clause become the section heading', () => {
    // This clause title once labelled 385 chunks it had nothing to do with.
    const { chunks } = chunk([
      { pageNumber: 1, text: 'SPECIAL CONDITIONS OF CONTRACT\n1. Scope of the contract.' },
      {
        pageNumber: 2,
        text: '12. Termination of Contract for Failure to Become Effective\nThe contract ends if...',
      },
      { pageNumber: 3, text: '13. Payment shall be made within 30 days of invoice.' },
    ]);

    expect(chunks.every((c) => !c.sectionHeading?.startsWith('12.'))).toBe(true);
    expect(chunks.find((c) => c.pageNumber === 3)?.sectionHeading).toBe(
      'SPECIAL CONDITIONS OF CONTRACT',
    );
  });

  it('treats a lettered line as a subsection of the current section', () => {
    const { chunks } = chunk([
      { pageNumber: 1, text: 'INSTRUCTIONS TO BIDDERS\nPreamble text for bidders here.' },
      { pageNumber: 2, text: 'E. Obligations of the Procuring Agency\nThe agency shall pay.' },
    ]);

    expect(chunks.find((c) => c.pageNumber === 2)?.sectionHeading).toBe(
      'INSTRUCTIONS TO BIDDERS > E. Obligations of the Procuring Agency',
    );
  });

  it('merges a small fragment into a neighbour on the same page', () => {
    const body = 'The language of the proposals and all correspondence shall be English. '.repeat(
      3,
    );
    const { chunks } = chunk([
      { pageNumber: 17, text: `1. ${body}\nB. Preparation of Proposals\nBDS Clause Number 3` },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain('BDS Clause Number 3');
  });

  it('leaves a small page alone rather than merging across pages', () => {
    const { chunks } = chunk([
      { pageNumber: 1, text: '1. Short clause.' },
      { pageNumber: 2, text: '2. Another short clause.' },
    ]);

    expect(chunks.map((c) => c.pageNumber)).toEqual([1, 2]);
  });

  it('keeps a bare number at the top of a page rather than deleting it', () => {
    // Often a printed page number, but a bare number at a page edge can also be a
    // table quantity, so it is kept and merged, never dropped on a guess.
    const { chunks } = chunk([
      { pageNumber: 2, text: '2\nTABLE OF CONTENTS\n1. Instruction To Users Of This Document 3' },
    ]);

    expect(chunks.map((c) => c.text).join('\n')).toMatch(/^2\n/);
    expect(chunks.every((c) => c.tokenCount > 1)).toBe(true);
  });

  it('never merges past the cap, counting the newline that joins the two parts', () => {
    // Two parts whose counts sum to exactly 400. The joining newline is a token too, so
    // the merged text would be 401. The corpus had one such chunk and it was never reported.
    const small = '2. Payment within thirty days';
    let big = '1. item';
    while (count(big) + count(small) < MAX_TOKENS) big += ' item';
    expect(count(big) + count(small)).toBe(MAX_TOKENS);
    expect(count(`${big}\n${small}`)).toBeGreaterThan(MAX_TOKENS);

    const { chunks, oversize } = chunk([{ pageNumber: 1, text: `${big}\n${small}` }]);

    expect(oversize).toEqual([]);
    expect(chunks.every((c) => c.tokenCount <= MAX_TOKENS)).toBe(true);
  });

  it('splits text the old estimate passed but the real tokenizer does not', () => {
    // Dates and amounts, which a Bid Data Sheet is full of, cost more tokens than
    // characters over four suggests. Under the estimate this was one chunk over the cap.
    const line = 'Bid Security: PKR 1,250,000/- valid till 06/10/2026 14:30 PST (Ref 17.3).';
    const text = Array.from({ length: 20 }, () => line).join('\n');
    expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(MAX_TOKENS);
    expect(count(text)).toBeGreaterThan(MAX_TOKENS);

    const { chunks, oversize } = chunk([{ pageNumber: 1, text }]);

    expect(oversize).toEqual([]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.tokenCount <= MAX_TOKENS)).toBe(true);
  });

  it('records token counts from the embedding model tokenizer', () => {
    // Two lines, since a one-line title-like page is taken as a divider heading.
    const text = 'Clarification Date:\nTuesday, October 6, 2026';
    const { chunks } = chunk([{ pageNumber: 1, text }]);
    expect(chunks[0]?.tokenCount).toBe(count(text));
  });
});

describe('chunking real EPADS pages', () => {
  it('keeps a BDS field and its value in the same chunk', async () => {
    const { chunks } = chunk(await pagesOf('epads/pakpost_p102751_bidding_document.pdf'));
    const field = chunks.find((c) => c.text.includes('Clarification Date:'));

    expect(field).toBeDefined();
    expect(field?.text).toContain('Tuesday, October 6, 2026');
  });

  it('labels Bid Data Sheet chunks and carries the heading onto the next page', async () => {
    const { chunks } = chunk(await pagesOf('epads/pakpost_p102751_bidding_document.pdf'));

    const onPage17 = chunks.filter((c) => c.pageNumber === 17);
    const firstOn18 = chunks.find((c) => c.pageNumber === 18);

    expect(onPage17.some((c) => c.sectionHeading?.startsWith('Proposal Data Sheet (BDS)'))).toBe(
      true,
    );
    expect(firstOn18?.sectionHeading?.startsWith('Proposal Data Sheet (BDS)')).toBe(true);
  });

  it('leaves no EPADS footer in any chunk of a whole document', async () => {
    const { chunks } = chunk(await pagesOf('epads/pakpost_p102751_bidding_document.pdf'));

    expect(chunks.filter((c) => c.text.includes('generated document'))).toEqual([]);
  });
});

describe('chunking real KP Health pages', () => {
  it('chunks a different agency template without losing its numbered sections', async () => {
    const { chunks } = chunk(
      await pagesOf('kphealth/kphealth_stationery-2026-27_bidding_document.pdf'),
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => /Bid Security/i.test(c.text))).toBe(true);
    expect(chunks.every((c) => c.tokenCount <= MAX_TOKENS)).toBe(true);
  });
});
