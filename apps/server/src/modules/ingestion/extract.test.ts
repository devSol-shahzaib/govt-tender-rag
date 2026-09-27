import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countExtractableChars,
  extractPageText,
  OCR_CHAR_THRESHOLD,
  renderPageToPng,
} from './extract.js';

const corpusRoot = fileURLToPath(new URL('../../../../../corpus/', import.meta.url));
const read = (relative: string) =>
  readFile(path.join(corpusRoot, relative)).then((b) => new Uint8Array(b));

describe('countExtractableChars', () => {
  it('ignores whitespace, which is how the threshold is defined', () => {
    expect(countExtractableChars('  a b\n c ')).toBe(3);
    expect(countExtractableChars('   ')).toBe(0);
  });
});

describe('extractPageText', () => {
  it('returns one entry per physical page, numbered from 1', async () => {
    const pages = await extractPageText(await read('epads/pakpost_p102751_bidding_document.pdf'));

    expect(pages).toHaveLength(83);
    expect(pages[0]?.pageNumber).toBe(1);
    expect(pages.at(-1)?.pageNumber).toBe(83);
  });

  it('numbers pages physically even where the document prints something else', async () => {
    // Physical page 30 of this document prints "Page 27 of 80" in its footer. A
    // citation that opens the wrong page is indistinguishable from a wrong answer.
    const pages = await extractPageText(await read('epads/pakpost_p102751_bidding_document.pdf'));
    const page30 = pages.find((p) => p.pageNumber === 30);

    expect(page30?.text).toContain('Page 27 of 80');
    expect(page30?.pageNumber).toBe(30);
  });

  it('does not flag EPADS section dividers for OCR, though they are short', async () => {
    // These carry 60 to 99 characters of real text. The audit's 100-char threshold
    // would send 499 of them to a vision model for nothing.
    const pages = await extractPageText(await read('epads/pakpost_p102751_bidding_document.pdf'));

    expect(pages.filter((p) => p.needsOcr)).toEqual([]);
    expect(pages.some((p) => p.charCount < 100)).toBe(true);
  });

  it('flags a CamScanner page whose only text layer is the watermark', async () => {
    const pages = await extractPageText(
      await read('kphealth/kphealth_antimalaria-2025-26_corrigendum-1.pdf'),
    );

    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toBe('CamScanner');
    expect(pages[0]?.charCount).toBeLessThan(OCR_CHAR_THRESHOLD);
    expect(pages[0]?.needsOcr).toBe(true);
  });

  it('flags every page of a document that has no text at all', async () => {
    const pages = await extractPageText(
      await read('kphealth/kphealth_bemonc-516119_prebid_minutes-2.pdf'),
    );

    expect(pages).toHaveLength(14);
    expect(pages.every((p) => p.needsOcr)).toBe(true);
  });

  it('flags only the image-only pages inside an otherwise readable document', async () => {
    // A document the corpus audit calls digital, yet it carries image-only pages.
    const pages = await extractPageText(
      await read('kphealth/kphealth_fp-commodities-hcip_bidding_document.pdf'),
    );

    const needing = pages.filter((p) => p.needsOcr);
    expect(needing).toHaveLength(10);
    expect(needing.length).toBeLessThan(pages.length);
  });
});

describe('renderPageToPng', () => {
  it('renders a scanned page to a PNG the vision model can read', async () => {
    const png = await renderPageToPng(
      await read('kphealth/kphealth_antimalaria-2025-26_corrigendum-1.pdf'),
      1,
    );

    // PNG magic number, so this is a real image rather than an empty buffer.
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.byteLength).toBeGreaterThan(10_000);
  });
});
