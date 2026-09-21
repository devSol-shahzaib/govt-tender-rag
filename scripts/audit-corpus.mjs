#!/usr/bin/env node
// Corpus audit for the tender RAG project.
// Usage: node audit-corpus.mjs <path-to-Documents-folder>
// Writes corpus-audit.csv next to sources.csv and prints a summary.

import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = path.resolve(process.argv[2] ?? './Documents');
const MIN_CHARS_PER_TEXT_PAGE = 100; // below this, a page probably has no real text layer
// Verdict: digital if >= 75% of pages have text (forms and blank pages are normal), scanned if <= 25%.

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function inspectPdf(file) {
  const data = new Uint8Array(await fs.readFile(file));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  let totalChars = 0;
  let textPages = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const chars = content.items.map((it) => it.str ?? '').join('').replace(/\s+/g, '').length;
    totalChars += chars;
    if (chars >= MIN_CHARS_PER_TEXT_PAGE) textPages++;
    page.cleanup();
  }
  const pages = doc.numPages;
  await doc.destroy();
  const textRatio = pages ? textPages / pages : 0;
  const verdict = textRatio >= 0.75 ? 'digital' : textRatio <= 0.25 ? 'scanned' : 'mixed';
  return { pages, textPages, avgCharsPerPage: Math.round(totalChars / Math.max(pages, 1)), verdict };
}

// Minimal CSV parser that handles quoted fields with commas and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  const [header = [], ...body] = rows;
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const csvEscape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

async function main() {
  const files = (await walk(ROOT)).filter((f) => !/sources\.csv$|corpus-audit\.csv$/.test(f));
  const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

  const results = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const base = { file: rel(file), ext, sizeKb: Math.round((await fs.stat(file)).size / 1024) };
    if (ext !== '.pdf') { results.push({ ...base, verdict: 'not-pdf' }); continue; }
    try {
      results.push({ ...base, ...(await inspectPdf(file)) });
    } catch (err) {
      results.push({ ...base, verdict: 'error', error: err.message.slice(0, 80) });
    }
    process.stdout.write('.');
  }
  console.log('\n');

  // Cross-check with sources.csv
  let sources = [];
  try { sources = parseCsv(await fs.readFile(path.join(ROOT, 'sources.csv'), 'utf8')); }
  catch { console.log('WARNING: sources.csv not found in', ROOT); }
  const csvFiles = new Set(sources.map((s) => s.file));
  const diskFiles = new Set(results.map((r) => r.file));
  const missingFromCsv = [...diskFiles].filter((f) => !csvFiles.has(f));
  const missingOnDisk = [...csvFiles].filter((f) => f && !diskFiles.has(f));

  // Amendment pairs: tenders with a base document plus at least one amendment
  const byTender = new Map();
  for (const s of sources) {
    if (!s.tender_id) continue;
    if (!byTender.has(s.tender_id)) byTender.set(s.tender_id, new Set());
    byTender.get(s.tender_id).add(s.doc_type);
  }
  const amendTypes = ['corrigendum', 'addendum', 'revised'];
  const pairs = [...byTender].filter(([, t]) => t.has('bidding_document') && amendTypes.some((a) => t.has(a)));

  // Write per-file report
  const cols = ['file', 'ext', 'sizeKb', 'pages', 'textPages', 'avgCharsPerPage', 'verdict', 'error'];
  const csvOut = [cols.join(','), ...results.map((r) => cols.map((c) => csvEscape(r[c] ?? '')).join(','))].join('\n');
  await fs.writeFile(path.join(ROOT, 'corpus-audit.csv'), csvOut);

  // Summary
  const pdfs = results.filter((r) => r.ext === '.pdf' && r.verdict !== 'error');
  const count = (v) => pdfs.filter((r) => r.verdict === v).length;
  const short = pdfs.filter((r) => r.pages < 3);
  const pct = (n) => (pdfs.length ? Math.round((100 * n) / pdfs.length) : 0);

  console.log('=== Corpus audit ===');
  console.log(`Files: ${results.length} (PDF: ${pdfs.length}, non-PDF: ${results.filter((r) => r.verdict === 'not-pdf').length}, errors: ${results.filter((r) => r.verdict === 'error').length})`);
  console.log(`Digital: ${count('digital')} (${pct(count('digital'))}%)  Mixed: ${count('mixed')}  Scanned: ${count('scanned')}`);
  console.log(`Total pages: ${pdfs.reduce((a, r) => a + r.pages, 0)}  Short files (<3 pages): ${short.length}`);
  console.log(`Tenders in sources.csv: ${byTender.size}  With amendment pairs: ${pairs.length}`);
  console.log('');
  console.log('Pass criteria:');
  console.log(`  [${pdfs.length - short.length >= 30 ? 'x' : ' '}] At least 30 full documents (${pdfs.length - short.length})`);
  console.log(`  [${pct(count('digital')) >= 60 ? 'x' : ' '}] At least 60% digital (${pct(count('digital'))}%)`);
  console.log(`  [${pairs.length >= 4 ? 'x' : ' '}] At least 4 original + amendment pairs (${pairs.length})`);
  if (missingFromCsv.length) console.log(`\nOn disk but not in sources.csv (${missingFromCsv.length}):\n  ` + missingFromCsv.join('\n  '));
  if (missingOnDisk.length) console.log(`\nIn sources.csv but not on disk (${missingOnDisk.length}):\n  ` + missingOnDisk.join('\n  '));
  const odd = results.filter((r) => ['scanned', 'mixed', 'error'].includes(r.verdict));
  if (odd.length) console.log('\nScanned / mixed / errors:\n  ' + odd.map((r) => `${r.verdict.padEnd(8)} ${r.file}${r.error ? ' (' + r.error + ')' : ''}`).join('\n  '));
  console.log(`\nFull report: ${path.join(ROOT, 'corpus-audit.csv')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
