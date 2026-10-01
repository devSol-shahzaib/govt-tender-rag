import { createHash } from 'node:crypto';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import type { ModelConfig } from '../config/models.js';
import { Gateway, type GatewayOptions } from './gateway.js';

const STUB_MODELS: ModelConfig = {
  main: 'stub-main',
  cheap: 'stub-cheap',
  embedding: 'stub-embedding',
  vision: 'stub-vision',
};

export interface StubGatewayOptions extends Omit<GatewayOptions, 'modelResolver' | 'apiKey'> {
  /** Text the stub returns for every call. */
  readonly text?: string;
  /**
   * Rejects every call with this instead of answering. Typed as Error rather than
   * unknown: retry classification reads statusCode off it, so callers attach that to
   * a real Error.
   */
  readonly failWith?: Error;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /**
   * Length of the vectors the stub embedding model returns. Defaults to 1536, the
   * native size of text-embedding-3-small, which F006 stores.
   */
  readonly embeddingDimensions?: number;
}

/**
 * A unit vector derived from the text alone. The same text always gives the same
 * vector and different texts give unrelated ones, so nearest-neighbour checks behave
 * the way they would with a real model on distinct chunks.
 */
export function stubEmbedding(text: string, dimensions: number): number[] {
  const values: number[] = [];
  for (let block = 0; values.length < dimensions; block += 1) {
    const digest = createHash('sha256')
      .update(`${String(block)}:${text}`)
      .digest();
    for (let i = 0; i + 1 < digest.length && values.length < dimensions; i += 2) {
      values.push(digest.readUInt16BE(i) / 32_768 - 1);
    }
  }
  const length = Math.hypot(...values);
  return values.map((v) => v / length);
}

/**
 * A Gateway that answers from a canned response and never opens a connection.
 *
 * Lives here rather than in each consumer so that the AI SDK stays an implementation
 * detail of this package, and so the easy way to test a model call is also the way
 * that makes no real call (CLAUDE.md, and D009's load testing needs the same seam).
 */
export function createStubGateway(options: StubGatewayOptions = {}): Gateway {
  const inputTokens = options.inputTokens ?? 800;
  const outputTokens = options.outputTokens ?? 150;
  const failWith = options.failWith;
  const embeddingDimensions = options.embeddingDimensions ?? 1536;

  return new Gateway({
    ...options,
    models: options.models ?? STUB_MODELS,
    retry: options.retry ?? { sleep: () => Promise.resolve(), maxAttempts: 2 },
    modelResolver: () =>
      new MockLanguageModelV4({
        doGenerate: () => {
          if (failWith !== undefined) return Promise.reject(failWith);

          return Promise.resolve({
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage: {
              inputTokens: {
                total: inputTokens,
                noCache: inputTokens,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
            },
            content: [{ type: 'text' as const, text: options.text ?? '' }],
            warnings: [],
          });
        },
      }),
    embeddingModelResolver: () =>
      new MockEmbeddingModelV4({
        // Matches OpenAI's limit, so a batch reaches the stub as one request, as in production.
        maxEmbeddingsPerCall: 2048,
        doEmbed: ({ values }) => {
          if (failWith !== undefined) return Promise.reject(failWith);

          return Promise.resolve({
            embeddings: values.map((v) => stubEmbedding(v, embeddingDimensions)),
            // Not a real count, only something nonzero for cost arithmetic to act on.
            usage: { tokens: values.reduce((sum, v) => sum + Math.ceil(v.length / 4), 0) },
            warnings: [],
          });
        },
      }),
  });
}
