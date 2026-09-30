import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * pdf.js needs the 14 standard PDF fonts to render pages whose fonts are not embedded.
 * Without them it warns and substitutes, which would put wrong glyphs into the images
 * sent for OCR. Resolved from the installed package so it cannot drift from the version
 * actually in use.
 *
 * A plain filesystem path, not a file:// URL, despite the option's name. On Node, pdf.js
 * concatenates this string with a font file name and hands the result to
 * fs.readFile, which reads a "file://..." string as a relative path that does not
 * exist. The trailing separator matters for the same reason.
 */
const STANDARD_FONT_DATA_URL =
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
    'standard_fonts',
  ) + path.sep;

function openDocument(pdfBytes: Uint8Array) {
  // The buffer is copied because pdf.js takes ownership of it and detaches it, leaving
  // the caller's array empty for any second use.
  return getDocument({
    data: new Uint8Array(pdfBytes),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;
}
/**
 * pdf.js types `canvasFactory` as bare `Object`, so the shape it actually returns is
 * declared here rather than reached for with `any`. Checked against pdfjs-dist 6.3.289.
 *
 * This is why apps/server includes the DOM lib: pdf.js is a browser library and its
 * render signature is typed against CanvasRenderingContext2D. Without DOM that type
 * resolves to an error type, and everything derived from it becomes silently untyped
 * rather than failing loudly. The DOM lib is type-level only; nothing here runs in a
 * browser.
 */
interface NodeCanvasFactory {
  create(
    width: number,
    height: number,
  ): {
    // @napi-rs/canvas stands in for HTMLCanvasElement here and adds toBuffer, which
    // the DOM type has no equivalent of. The intersection describes both halves.
    canvas: HTMLCanvasElement & { toBuffer(mimeType: 'image/png'): Buffer };
    context: CanvasRenderingContext2D;
  };
}

/**
 * A page with fewer extractable characters than this is treated as having no text
 * layer and is sent to OCR.
 *
 * 20, because the corpus has a real break there. Below it are image-only pages, pages
 * carrying a stray character, and the CamScanner corrigenda whose entire text layer is
 * the word "CamScanner". From 20 up the text is genuine, starting with short section
 * dividers like "Additional Forms and Documents 66". The corpus audit's threshold of
 * 100 classifies whole documents; applied per page it would send 499 EPADS dividers
 * with perfectly good text to a vision model.
 */
export const OCR_CHAR_THRESHOLD = 20;

export interface ExtractedPage {
  /** Physical page, 1-based. Never the printed footer number, which disagrees. */
  readonly pageNumber: number;
  readonly text: string;
  readonly charCount: number;
  readonly needsOcr: boolean;
}

/** Characters ignoring whitespace, which is how the threshold is defined. */
export function countExtractableChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * Identifies the extraction logic that produced a document's pages. Bump it whenever
 * extraction changes, and every document is re-extracted on the next run. Without it,
 * documents extracted by older logic would be skipped forever, because their bytes did
 * not change.
 *
 * lines-v2: keeps pdf.js line ends. v1 flattened each page onto a single line, which
 * lost the headings, clause markers and field lines that chunking needs.
 */
export const EXTRACTOR_VERSION = 'lines-v2';

export interface TextItemLike {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

/**
 * Joins pdf.js text items into page text, keeping line breaks.
 *
 * Items on the same line are joined with a space, exactly as v1 joined every item.
 * Joining with nothing glues words that pdf.js stores as separate items, turning
 * "through EPADS" into "throughEPADS". Only a line end becomes a newline, so the text
 * ignoring whitespace is identical to v1's, and so are the OCR decisions, which are
 * counted ignoring whitespace.
 */
export function joinTextItems(items: readonly TextItemLike[]): string {
  const raw = items
    .map((item) => (item.str === undefined ? '' : item.str + (item.hasEOL === true ? '\n' : ' ')))
    .join('');

  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Reads every page's text layer.
 *
 * Page numbers are physical and 1-based, matching pdf.js. EPADS documents print a
 * different number in the footer: physical page 30 of pakpost_p102751 prints
 * "Page 27 of 80". A citation that opens the wrong page is indistinguishable from a
 * wrong answer (D003), so the printed number is never used.
 */
export async function extractPageText(pdfBytes: Uint8Array): Promise<ExtractedPage[]> {
  const document = await openDocument(pdfBytes);
  const pages: ExtractedPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = joinTextItems(content.items as readonly TextItemLike[]);
      const charCount = countExtractableChars(text);

      pages.push({
        pageNumber,
        text,
        charCount,
        needsOcr: charCount < OCR_CHAR_THRESHOLD,
      });

      page.cleanup();
    }
  } finally {
    // destroy() is absent from the published types; cleanup() is typed and releases
    // the page resources this loop allocated.
    await document.cleanup();
  }

  return pages;
}

/**
 * Renders a page to PNG for OCR.
 *
 * Scale 1.5 rather than 2: a page comes out around 300KB instead of 600KB, and image
 * size drives the cost of every vision call.
 */
export async function renderPageToPng(
  pdfBytes: Uint8Array,
  pageNumber: number,
  scale = 1.5,
): Promise<Uint8Array> {
  const document = await openDocument(pdfBytes);

  try {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const factory = document.canvasFactory as NodeCanvasFactory;
    const canvasAndContext = factory.create(viewport.width, viewport.height);

    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvas: canvasAndContext.canvas,
    }).promise;

    return new Uint8Array(canvasAndContext.canvas.toBuffer('image/png'));
  } finally {
    await document.cleanup();
  }
}
