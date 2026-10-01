import { describe, expect, it } from 'vitest';
import { createTokenCounter } from './tokens.js';

describe('createTokenCounter', () => {
  const counter = createTokenCounter('text-embedding-3-small');

  it('uses the encoding the embedding model tokenizes with', () => {
    expect(counter.encoding).toBe('cl100k_base');
  });

  it('counts known strings exactly', () => {
    // "hello world" is cl100k tokens 15339 and 1917. The tender line splits as
    // Clar|ification| Date|:| Tuesday|,| October| |6|,| |202|6: cl100k keeps the space
    // before a digit separate and groups digits in threes.
    expect(counter.count('hello world')).toBe(2);
    expect(counter.count('Clarification Date: Tuesday, October 6, 2026')).toBe(13);
  });

  it('counts an empty string as zero', () => {
    expect(counter.count('')).toBe(0);
  });

  it('counts dense tender text above the characters-over-four estimate', () => {
    // Numbers, codes and dates split into many tokens, which is why the estimate was replaced.
    const text = 'PKR 1,250,000/- (2%) Ref: P102751-BDS-17.3(a) 06/10/2026 14:30 PST';
    expect(counter.count(text)).toBeGreaterThan(Math.ceil(text.length / 4));
  });

  it('treats special-token text inside a document as ordinary characters', () => {
    expect(counter.count('see <|endoftext|> here')).toBeGreaterThan(3);
  });

  it('refuses a model it has no encoding for, rather than guessing', () => {
    expect(() => createTokenCounter('stub-embedding')).toThrow(/stub-embedding/);
  });
});
