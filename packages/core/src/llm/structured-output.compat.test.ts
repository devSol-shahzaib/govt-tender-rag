import { generateObject } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Compatibility check required by the F001 spec.
 *
 * D013 picked Zod 4 ahead of the Zod 3 proven in the portfolio project, and every
 * structured extraction from F009 onward depends on the AI SDK handing a model
 * response to a Zod schema. This proves the two work together before the gateway is
 * written, rather than discovering it when there is real code to unpick.
 *
 * The model is mocked, so no request leaves the machine. CLAUDE.md forbids real API
 * calls in tests.
 */
const bidSecuritySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  isPercentageOfBid: z.boolean(),
});

function mockReturning(text: string) {
  // The result is handed over directly rather than wrapped in Promise.resolve, which
  // would break contextual typing and silently widen the literal fields.
  return new MockLanguageModelV4({
    doGenerate: {
      // finishReason is an object in the V4 provider spec, not a string. A plain
      // 'stop' type-checks as wrong but runs fine, because generateObject only reads
      // content[].text.
      // `raw` is required, not optional: a real provider always reports its own
      // finish reason alongside the unified one. undefined models a provider that
      // sent none.
      finishReason: { unified: 'stop', raw: 'stop' },
      // Token counts are per-category objects, not plain numbers: the provider spec
      // separates cached from uncached input and reasoning from text output, which is
      // what Module 1's cost tracking will need.
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 20, text: 20, reasoning: 0 },
      },
      content: [{ type: 'text', text }],
      warnings: [],
    },
  });
}

describe('Zod 4 with the AI SDK structured output helpers', () => {
  it('parses a valid structured response into the schema type', async () => {
    const { object } = await generateObject({
      model: mockReturning(
        JSON.stringify({ amount: 500000, currency: 'PKR', isPercentageOfBid: false }),
      ),
      schema: bidSecuritySchema,
      prompt: 'Extract the bid security from this tender.',
    });

    expect(object).toEqual({
      amount: 500000,
      currency: 'PKR',
      isPercentageOfBid: false,
    });
  });

  it('rejects a response that breaks a schema rule', async () => {
    // A negative amount is well-formed JSON the model could plausibly return. If Zod 4
    // validation were not actually running, this would pass straight through.
    await expect(
      generateObject({
        model: mockReturning(
          JSON.stringify({ amount: -1, currency: 'PKR', isPercentageOfBid: false }),
        ),
        schema: bidSecuritySchema,
        prompt: 'Extract the bid security from this tender.',
      }),
    ).rejects.toThrow();
  });

  it('rejects a response missing a required field', async () => {
    await expect(
      generateObject({
        model: mockReturning(JSON.stringify({ currency: 'PKR' })),
        schema: bidSecuritySchema,
        prompt: 'Extract the bid security from this tender.',
      }),
    ).rejects.toThrow();
  });
});
