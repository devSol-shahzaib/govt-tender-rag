import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCoverage, hashDocument, listCorpusFiles } from './corpus.js';
import { parseManifest } from './manifest.js';
import { readFileSync } from 'node:fs';

const corpusRoot = fileURLToPath(new URL('../../../../../corpus/', import.meta.url));

describe('checkCoverage', () => {
  it('passes when the manifest and the disk agree', () => {
    const result = checkCoverage(['a.pdf', 'b.pdf'], ['a.pdf', 'b.pdf']);

    expect(result.missingOnDisk).toEqual([]);
    expect(result.missingFromManifest).toEqual([]);
  });

  it('reports a manifest row whose file is absent', () => {
    const result = checkCoverage(['a.pdf', 'gone.pdf'], ['a.pdf']);

    expect(result.missingOnDisk).toEqual(['gone.pdf']);
  });

  it('reports a file on disk that the manifest never mentions', () => {
    // This is the direction that matters: the manifest once covered 38 of 66 files
    // and an import would have reported success.
    const result = checkCoverage(['a.pdf'], ['a.pdf', 'unlisted.pdf']);

    expect(result.missingFromManifest).toEqual(['unlisted.pdf']);
  });

  it('does not report deliberately skipped rows as missing from the manifest', () => {
    const result = checkCoverage(['a.pdf'], ['a.pdf', 'skipped.pdf'], ['skipped.pdf']);

    expect(result.missingFromManifest).toEqual([]);
  });
});

describe('hashDocument', () => {
  it('gives the same hash to byte-identical files and a different one otherwise', async () => {
    const [ngc, copy, other] = await Promise.all([
      hashDocument(path.join(corpusRoot, 'epads/ngc_p96607_bidding_document.pdf')),
      hashDocument(path.join(corpusRoot, 'epads/test_p96607_bidding_document.pdf')),
      hashDocument(path.join(corpusRoot, 'epads/pakpost_p102751_bidding_document.pdf')),
    ]);

    expect(ngc).toBe(copy);
    expect(ngc).not.toBe(other);
    expect(ngc).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the real corpus', () => {
  it('is fully covered by the manifest in both directions', async () => {
    const { entries, skipped } = parseManifest(
      readFileSync(path.join(corpusRoot, 'sources.csv'), 'utf8'),
    );
    const onDisk = await listCorpusFiles(corpusRoot);

    const result = checkCoverage(
      entries.map((e) => e.filePath),
      onDisk,
      skipped.map((s) => s.filePath),
    );

    expect(result).toEqual({ missingOnDisk: [], missingFromManifest: [] });
    expect(onDisk).toHaveLength(66);
  });
});
