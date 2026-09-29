import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { Gateway } from './gateway.js';
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
