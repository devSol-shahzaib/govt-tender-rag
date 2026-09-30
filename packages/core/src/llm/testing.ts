import { MockLanguageModelV4 } from 'ai/test';
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
  });
}
