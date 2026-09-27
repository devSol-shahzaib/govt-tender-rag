/**
 * Prompt for reading a rendered tender page.
 *
 * Versioned here rather than inlined at the call site, because a prompt change is a
 * code change and gets reviewed like one (CLAUDE.md). Bump the version when the text
 * changes, so a build log entry can say which prompt produced which extraction.
 */
export const PAGE_OCR_PROMPT_VERSION = 'page-ocr.v1';

export const PAGE_OCR_PROMPT = [
  'Transcribe every piece of text on this page of a public procurement document.',
  '',
  'Rules:',
  '- Reproduce the text exactly. Do not summarise, translate, correct or explain.',
  '- Keep tables as markdown tables. A query and the response to it must stay in the',
  '  same row, because separating them changes what the document says.',
  '- Keep dates, times, amounts and reference numbers exactly as written, including',
  '  ordinal suffixes such as 24th.',
  '- Include headers, footers, stamps and handwritten annotations. A handwritten',
  '  correction over a printed value is often the change the document exists to make.',
  '- If a region is illegible, write [illegible] rather than guessing.',
  '- Output only the transcription, with no preamble.',
].join('\n');
