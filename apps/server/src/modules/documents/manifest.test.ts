import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseListingDate, parseManifest } from './manifest.js';

describe('parseListingDate', () => {
  it('parses the EPADS format without shifting the day', () => {
    // new Date("August 24, 2026").toISOString() gives 2026-08-23 on a machine east of
    // UTC. That silent off-by-one is the reason this function exists.
    expect(parseListingDate('August 24, 2026')).toBe('2026-08-24');
  });

  it('parses the KP Health format without shifting the day', () => {
    expect(parseListingDate('24-February-2026')).toBe('2026-02-24');
  });

  it('pads single digit days', () => {
    expect(parseListingDate('6-February-2026')).toBe('2026-02-06');
    expect(parseListingDate('September 07, 2026')).toBe('2026-09-07');
  });

  it('is case insensitive about the month name', () => {
    expect(parseListingDate('18-MAY-2026')).toBe('2026-05-18');
  });

  it('rejects a date that does not exist', () => {
    expect(() => parseListingDate('31-April-2026')).toThrowError(/not a real calendar date/);
  });

  it('rejects an unknown month', () => {
    expect(() => parseListingDate('32-Smarch-2026')).toThrowError(/Unrecognised/);
  });

  it('rejects a format we have not seen, rather than guessing', () => {
    // An ambiguous numeric date must not be silently read as one order or the other.
    expect(() => parseListingDate('03/04/2026')).toThrowError(/Unrecognised listing date format/);
  });
});

const HEADER =
  'tender_id,file,doc_type,version,agency,title,url,date_on_listing,downloaded_on,source,notes\n';

describe('parseManifest', () => {
  it('maps a row onto the fields the documents table needs', () => {
    const csv =
      HEADER +
      'ngc_p96607,epads/a.pdf,bidding_document,current,NGC,Route survey,https://example.test/1,"August 24, 2026",,epads,\n';

    const [entry] = parseManifest(csv).entries;

    expect(entry).toEqual({
      tenderReference: 'ngc_p96607',
      filePath: 'epads/a.pdf',
      docType: 'bidding_document',
      versionLabel: 'current',
      publishedOn: '2026-08-24',
      sourceUrl: 'https://example.test/1',
      agency: 'NGC',
      title: 'Route survey',
    });
  });

  it('handles quoted fields containing commas', () => {
    const csv =
      HEADER +
      'cda_p1,epads/b.pdf,bidding_document,current,"CDA, Works Division-I","Design, supervision and works",https://example.test/2,"September 07, 2026",,epads,\n';

    const [entry] = parseManifest(csv).entries;

    expect(entry?.agency).toBe('CDA, Works Division-I');
    expect(entry?.title).toBe('Design, supervision and works');
  });

  it('drops a row with no tender_id, because it has no tender to attach to', () => {
    const csv =
      HEADER +
      ',epads/bidding-document.pdf,bidding_document,current,NGC,Route survey,,"August 24, 2026",,epads,\n';

    const { entries, skipped } = parseManifest(csv);

    expect(entries).toHaveLength(0);
    expect(skipped[0]).toMatchObject({
      filePath: 'epads/bidding-document.pdf',
      reason: 'no_tender_id',
    });
  });

  it('drops a test_ prefixed tender id as a collection artefact', () => {
    const csv =
      HEADER +
      'test_p96607,epads/test_p96607_bidding_document.pdf,bidding_document,current,NGC,Route survey,,"August 24, 2026",,epads,\n';

    const { entries, skipped } = parseManifest(csv);

    expect(entries).toHaveLength(0);
    expect(skipped[0]?.reason).toBe('test_artefact');
  });

  it('orders the canonically named copy first within a hash group', () => {
    // Both files are byte identical, so only one passes the unique content hash.
    // Which one must follow from the naming convention, not from CSV row order.
    const csv =
      HEADER +
      'ngc_p96607,epads/aaa-unconventional-name.pdf,bidding_document,current,NGC,Route survey,,"August 24, 2026",,epads,\n' +
      'ngc_p96607,epads/ngc_p96607_bidding_document.pdf,bidding_document,current,NGC,Route survey,,"August 24, 2026",,epads,\n';

    const { entries } = parseManifest(csv);

    // Alphabetically 'aaa-...' sorts first; the convention rule must beat that.
    expect(entries[0]?.filePath).toBe('epads/ngc_p96607_bidding_document.pdf');
  });

  it('turns empty optional columns into null rather than empty strings', () => {
    const csv =
      HEADER + 'x,epads/c.pdf,bidding_document,,Agency,Title,,"August 24, 2026",,epads,\n';

    const [entry] = parseManifest(csv).entries;

    expect(entry?.versionLabel).toBeNull();
    expect(entry?.sourceUrl).toBeNull();
  });

  it('names the spreadsheet row number when a date will not parse', () => {
    const csv =
      HEADER + 'x,epads/d.pdf,bidding_document,current,Agency,Title,,03/04/2026,,epads,\n';

    expect(() => parseManifest(csv)).toThrowError(/row 2 \(epads\/d\.pdf\)/);
  });

  it('rejects a doc_type outside the known vocabulary', () => {
    const csv =
      HEADER + 'x,epads/e.pdf,press_release,current,Agency,Title,,"August 24, 2026",,epads,\n';

    expect(() => parseManifest(csv)).toThrowError(/row 2 is invalid.*doc_type/s);
  });
});

describe('the real corpus manifest', () => {
  // corpus/ is read-only, so this only reads. It is a regression test against the
  // actual data: the parser is strict, and the corpus is the thing it has to survive.
  const manifestPath = fileURLToPath(new URL('../../../../../corpus/sources.csv', import.meta.url));
  const { entries, skipped } = parseManifest(readFileSync(manifestPath, 'utf8'));

  it('keeps 64 rows and drops 2, for stated reasons', () => {
    expect(entries).toHaveLength(64);
    expect(skipped.map((s) => s.reason).sort()).toEqual(['no_tender_id', 'test_artefact']);
  });

  it('keeps the canonically named copy of the triplicated file', () => {
    const kept = entries.filter((e) => e.filePath.includes('p96607'));
    expect(kept.map((e) => e.filePath)).toEqual(['epads/ngc_p96607_bidding_document.pdf']);
  });

  it('leaves 48 distinct tenders once the artefact is dropped', () => {
    expect(new Set(entries.map((e) => e.tenderReference)).size).toBe(48);
  });

  it('produces a valid ISO date for every row', () => {
    const bad = entries.filter((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.publishedOn));
    expect(bad).toEqual([]);
  });

  it('keeps the two known listing formats reading as the same calendar day', () => {
    const epads = entries.find((e) => e.filePath === 'epads/ngc_p96607_bidding_document.pdf');
    const kp = entries.find((e) => e.filePath.includes('bemonc-516119_bidding_document'));

    expect(epads?.publishedOn).toBe('2026-08-24');
    expect(kp?.publishedOn).toBe('2026-02-24');
  });
});
