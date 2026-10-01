import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { Gateway } from './gateway.js';
import { createStubGateway, stubEmbedding } from './testing.js';
import { GatewayError } from './types.js';

const MODELS = {
  main: 'main-id',
  cheap: 'cheap-id',
  embedding: 'embedding-id',
  vision: 'vision-id',
} as const;

/** finishReason is an object and usage is per-category in the V4 provider spec. */
function mockReturning(text: string, tokens = { input: 900, output: 120 }) {
  return new MockLanguageModelV4({
    doGenerate: {
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: tokens.input, noCache: tokens.input, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: tokens.output, text: tokens.output, reasoning: 0 },
      },
      content: [{ type: 'text', text }],
      warnings: [],
    },
  });
}

function mockThrowing(errors: Error[], then: string) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: () => {
      const error = errors[call];
      call += 1;
      if (error !== undefined) return Promise.reject(error);
      return Promise.resolve({
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        content: [{ type: 'text' as const, text: then }],
        warnings: [],
      });
    },
  });
}

const request = {
  image: new Uint8Array([1, 2, 3]),
  mediaType: 'image/png',
  prompt: 'Transcribe this page.',
};

const noWait = { sleep: () => Promise.resolve() };

describe('Gateway.readPageImage', () => {
  it('returns the model text and reports which model produced it', async () => {
    const gateway = new Gateway({
      models: MODELS,
      modelResolver: () => mockReturning('CORRIGENDUM. Bids now open 4 March 2026.'),
    });

    const result = await gateway.readPageImage(request);

    expect(result.value).toBe('CORRIGENDUM. Bids now open 4 March 2026.');
    expect(result.model).toBe('vision-id');
    expect(result.attempts).toBe(1);
  });

  it('captures token usage for every call', async () => {
    const gateway = new Gateway({ models: MODELS, modelResolver: () => mockReturning('text') });

    const result = await gateway.readPageImage(request);

    expect(result.usage.inputTokens).toBe(900);
    expect(result.usage.outputTokens).toBe(120);
  });

  it('computes cost when the model is priced', async () => {
    const gateway = new Gateway({
      models: MODELS,
      modelResolver: () => mockReturning('text', { input: 1_000_000, output: 1_000_000 }),
      pricing: { 'vision-id': { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 } },
    });

    const result = await gateway.readPageImage(request);

    expect(result.usage.costUsd).toBeCloseTo(12.5, 6);
  });

  it('leaves cost undefined rather than guessing when the model is not priced', async () => {
    // A fabricated cost is worse than none: it reads as a measurement.
    const gateway = new Gateway({ models: MODELS, modelResolver: () => mockReturning('text') });

    const result = await gateway.readPageImage(request);

    expect(result.usage.costUsd).toBeUndefined();
  });

  it('emits a call event so tracing and cost tracking have one place to attach', async () => {
    const onCall = vi.fn();
    const gateway = new Gateway({
      models: MODELS,
      modelResolver: () => mockReturning('text'),
      onCall,
    });

    await gateway.readPageImage(request);

    expect(onCall).toHaveBeenCalledOnce();
    expect(onCall.mock.calls[0]?.[0]).toMatchObject({
      operation: 'readPageImage',
      model: 'vision-id',
      attempts: 1,
    });
  });

  it('retries a rate limit and reports how many attempts it took', async () => {
    const rateLimited = Object.assign(new Error('rate limited'), { statusCode: 429 });
    const gateway = new Gateway({
      models: MODELS,
      modelResolver: () => mockThrowing([rateLimited], 'recovered'),
      retry: { ...noWait, maxAttempts: 3 },
    });

    const result = await gateway.readPageImage(request);

    expect(result.value).toBe('recovered');
    expect(result.attempts).toBe(2);
  });

  it('does not retry a bad request, which would only burn quota', async () => {
    const badRequest = Object.assign(new Error('invalid image'), { statusCode: 400 });
    let calls = 0;
    const gateway = new Gateway({
      models: MODELS,
      modelResolver: () =>
        new MockLanguageModelV4({
          doGenerate: () => {
            calls += 1;
            return Promise.reject(badRequest);
          },
        }),
      retry: { ...noWait, maxAttempts: 3 },
    });

    await expect(gateway.readPageImage(request)).rejects.toThrow(GatewayError);
    expect(calls).toBe(1);
  });

  it('fails with a GatewayError naming the operation and model after retries run out', async () => {
    const serverError = Object.assign(new Error('upstream exploded'), { statusCode: 503 });
    const gateway = new Gateway({
      models: MODELS,
      modelResolver: () => mockThrowing([serverError, serverError, serverError], 'never reached'),
      retry: { ...noWait, maxAttempts: 3 },
    });

    await expect(gateway.readPageImage(request)).rejects.toThrow(
      /readPageImage failed against vision-id/,
    );
  });
});

describe('Gateway reasoning effort', () => {
  function capturingModel(seen: { providerOptions?: unknown }[]) {
    return new MockLanguageModelV4({
      doGenerate: (options) => {
        seen.push({ providerOptions: options.providerOptions });
        return Promise.resolve({
          finishReason: { unified: 'stop' as const, raw: 'stop' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          content: [{ type: 'text' as const, text: 'ok' }],
          warnings: [],
        });
      },
    });
  }

  it('sends the configured effort to the provider', async () => {
    const seen: { providerOptions?: unknown }[] = [];
    const gateway = new Gateway({
      models: MODELS,
      modelResolver: () => capturingModel(seen),
      visionReasoningEffort: 'none',
    });

    await gateway.readPageImage(request);

    expect(seen[0]?.providerOptions).toEqual({ openai: { reasoningEffort: 'none' } });
  });

  it('sends nothing when unset, since a non-reasoning model may reject the parameter', async () => {
    const seen: { providerOptions?: unknown }[] = [];
    const gateway = new Gateway({ models: MODELS, modelResolver: () => capturingModel(seen) });

    await gateway.readPageImage(request);

    expect(seen[0]?.providerOptions).toBeUndefined();
  });
});

/** An embedding model that answers each call from the next entry, then repeats the last. */
function embeddingMock(answers: ((values: string[]) => number[][] | Error)[], tokens = 42) {
  let call = 0;
  const model = new MockEmbeddingModelV4({
    // OpenAI accepts 2048 inputs per request. The mock defaults to 1, which would make
    // embedMany split every batch into single-text requests.
    maxEmbeddingsPerCall: 2048,
    doEmbed: ({ values }) => {
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      const result = answer?.(values) ?? [];
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve({ embeddings: result, usage: { tokens }, warnings: [] });
    },
  });
  return { model, calls: () => call };
}

const DIMS = 4;
const vectorsFor = (values: string[]) => values.map((_, i) => [i, 0.5, -0.5, 0.25]);

describe('Gateway.embedChunks', () => {
  it('returns one vector per text, in order, from the configured embedding model', async () => {
    const { model } = embeddingMock([vectorsFor]);
    const gateway = new Gateway({ models: MODELS, embeddingModelResolver: () => model });

    const result = await gateway.embedChunks({ texts: ['a', 'b', 'c'], dimensions: DIMS });

    expect(result.value.map((v) => v[0])).toEqual([0, 1, 2]);
    expect(result.model).toBe('embedding-id');
  });

  it('records input tokens and prices them, with no output tokens', async () => {
    const { model } = embeddingMock([vectorsFor], 1_000_000);
    const gateway = new Gateway({
      models: MODELS,
      embeddingModelResolver: () => model,
      pricing: { 'embedding-id': { inputPerMillionUsd: 0.02, outputPerMillionUsd: 0 } },
    });

    const result = await gateway.embedChunks({ texts: ['a'], dimensions: DIMS });

    expect(result.usage.inputTokens).toBe(1_000_000);
    expect(result.usage.outputTokens).toBe(0);
    expect(result.usage.costUsd).toBeCloseTo(0.02, 6);
  });

  it('fails when the response has a different number of vectors than texts', async () => {
    const { model, calls } = embeddingMock([(values) => vectorsFor(values).slice(1)]);
    const gateway = new Gateway({ models: MODELS, embeddingModelResolver: () => model });

    await expect(gateway.embedChunks({ texts: ['a', 'b'], dimensions: DIMS })).rejects.toThrow(
      GatewayError,
    );
    // Not retried: asking again would pay twice for the same wrong answer.
    expect(calls()).toBe(1);
  });

  it('fails when a vector has the wrong length for the column it is going into', async () => {
    const { model } = embeddingMock([(values) => values.map(() => [0.1, 0.2, 0.3])]);
    const gateway = new Gateway({ models: MODELS, embeddingModelResolver: () => model });

    await expect(gateway.embedChunks({ texts: ['a'], dimensions: DIMS })).rejects.toThrow(
      /4 dimensions/,
    );
  });

  it('fails when a vector holds a value that is not a finite number', async () => {
    const { model } = embeddingMock([(values) => values.map(() => [0.1, Number.NaN, 0.3, 0.4])]);
    const gateway = new Gateway({ models: MODELS, embeddingModelResolver: () => model });

    await expect(gateway.embedChunks({ texts: ['a'], dimensions: DIMS })).rejects.toThrow(
      GatewayError,
    );
  });

  it('retries a rate limit itself, with the SDK retrying nothing on its own', async () => {
    const rateLimited = Object.assign(new Error('rate limited'), { statusCode: 429 });
    const { model, calls } = embeddingMock([() => rateLimited, vectorsFor]);
    const gateway = new Gateway({
      models: MODELS,
      embeddingModelResolver: () => model,
      retry: { ...noWait, maxAttempts: 3 },
    });

    const result = await gateway.embedChunks({ texts: ['a'], dimensions: DIMS });

    expect(result.attempts).toBe(2);
    expect(calls()).toBe(2);
  });

  it('refuses an empty batch without making a call', async () => {
    const { model, calls } = embeddingMock([vectorsFor]);
    const gateway = new Gateway({ models: MODELS, embeddingModelResolver: () => model });

    await expect(gateway.embedChunks({ texts: [], dimensions: DIMS })).rejects.toThrow(/empty/);
    expect(calls()).toBe(0);
  });
});

describe('stub embeddings', () => {
  it('gives the same text the same unit vector and other text an unrelated one', async () => {
    const gateway = createStubGateway();

    const { value } = await gateway.embedChunks({
      texts: ['Bid security', 'Bid security', 'Delivery period'],
      dimensions: 1536,
    });
    const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
    const [first, same, other] = value as [number[], number[], number[]];

    expect(first).toEqual(same);
    expect(dot(first, first)).toBeCloseTo(1, 6);
    expect(Math.abs(dot(first, other))).toBeLessThan(0.2);
    expect(first).toEqual(stubEmbedding('Bid security', 1536));
  });
});
