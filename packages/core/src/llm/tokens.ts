import { countTokens as countCl100k } from 'gpt-tokenizer/encoding/cl100k_base';

export interface TokenCounter {
  /** The tokenizer encoding. Part of the chunk fingerprint: a different encoding cuts differently. */
  readonly encoding: string;
  readonly count: (text: string) => number;
}

/**
 * Embedding models and the encoding each one tokenizes with. Kept as our own table rather
 * than gpt-tokenizer's model lookup, so a model it guesses at, or a new model nobody has
 * mapped yet, fails here instead of producing counts that look exact and are not.
 */
const EMBEDDING_ENCODINGS: Readonly<Record<string, 'cl100k_base'>> = {
  'text-embedding-3-small': 'cl100k_base',
  'text-embedding-3-large': 'cl100k_base',
  'text-embedding-ada-002': 'cl100k_base',
};

/**
 * Tender text is data, not a prompt, so a string such as "<|endoftext|>" inside it is
 * ordinary characters. gpt-tokenizer throws on it by default; the embedding API does not.
 */
const AS_PLAIN_TEXT = { disallowedSpecial: new Set<string>() };

/**
 * Exact token counts for an embedding model. Pure and local, so the chunker can size
 * chunks without a network call.
 */
export function createTokenCounter(modelId: string): TokenCounter {
  const encoding = EMBEDDING_ENCODINGS[modelId];
  if (encoding === undefined) {
    throw new Error(
      `No tokenizer encoding is known for embedding model "${modelId}". ` +
        `Known models: ${Object.keys(EMBEDDING_ENCODINGS).join(', ')}`,
    );
  }

  return {
    encoding,
    count: (text) => (text === '' ? 0 : countCl100k(text, AS_PLAIN_TEXT)),
  };
}
