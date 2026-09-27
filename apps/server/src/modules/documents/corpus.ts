import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ManifestEntry } from './manifest.js';

/** Extensions the corpus is expected to contain. Anything else is not a document. */
const DOCUMENT_EXTENSION = '.pdf';

export async function listCorpusFiles(corpusRoot: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    const dirents = await readdir(directory, { withFileTypes: true });

    for (const dirent of dirents) {
      const absolute = path.join(directory, dirent.name);

      if (dirent.isDirectory()) {
        await walk(absolute);
      } else if (path.extname(dirent.name).toLowerCase() === DOCUMENT_EXTENSION) {
        found.push(path.relative(corpusRoot, absolute));
      }
    }
  }

  await walk(corpusRoot);
  return found.sort();
}

export interface CoverageResult {
  readonly missingOnDisk: readonly string[];
  readonly missingFromManifest: readonly string[];
}

/**
 * Compares the manifest against the files actually present.
 *
 * Checked in both directions on purpose. The manifest once covered 38 of 66 files,
 * and every missing row was the half of the corpus holding the corrigenda, addenda and
 * scanned documents. An import that processes what it finds would have loaded 38
 * documents and reported success.
 *
 * `skippedPaths` are rows the manifest describes but the import deliberately leaves
 * out, so their files must not be reported as missing from the manifest.
 */
export function checkCoverage(
  manifestPaths: readonly string[],
  diskPaths: readonly string[],
  skippedPaths: readonly string[] = [],
): CoverageResult {
  const described = new Set([...manifestPaths, ...skippedPaths]);
  const onDisk = new Set(diskPaths);

  return {
    missingOnDisk: [...described].filter((p) => !onDisk.has(p)).sort(),
    missingFromManifest: [...onDisk].filter((p) => !described.has(p)).sort(),
  };
}

export function formatCoverageFailure(result: CoverageResult): string {
  const lines: string[] = [];

  if (result.missingOnDisk.length > 0) {
    lines.push(
      `${String(result.missingOnDisk.length)} manifest row(s) point at files that are not on disk:`,
      ...result.missingOnDisk.map((p) => `  ${p}`),
    );
  }

  if (result.missingFromManifest.length > 0) {
    lines.push(
      `${String(result.missingFromManifest.length)} file(s) on disk have no manifest row:`,
      ...result.missingFromManifest.map((p) => `  ${p}`),
    );
  }

  return lines.join('\n');
}

/**
 * SHA-256 of a document's bytes.
 *
 * The corpus holds three byte-identical copies of one 209-page document. Without this
 * they become three sets of chunks, and retrieval can return the same passage three
 * times, which reads as three sources agreeing rather than one counted thrice.
 */
export async function hashDocument(absolutePath: string): Promise<string> {
  const bytes = await readFile(absolutePath);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function hashManifestEntry(corpusRoot: string, entry: ManifestEntry): Promise<string> {
  return hashDocument(path.join(corpusRoot, entry.filePath));
}
