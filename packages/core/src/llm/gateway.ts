import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type LanguageModel } from 'ai';
import { loadModelConfig, type ModelConfig } from '../config/models.js';
import { withRetry, type RetryOptions } from './retry.js';
import { GatewayError, type GatewayResult, type ModelPricing, type Usage } from './types.js';

/**
 * The only place in the repo that calls a model provider (CLAUDE.md, D012).
 *
 * Everything that needs to happen around every call lives here: retry, usage and cost
 * capture, and the seam that lets a mock model stand in. Tracing and routing attach
 * here too when Modules 1 and 7 arrive, which is the point of a single choke point.
 */
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface GatewayOptions {
  readonly models?: ModelConfig;
  /**
   * Reasoning effort for page reading. Transcription gains nothing from reasoning,
   * and reasoning tokens are billed as output, so for a reasoning model this should be
   * `none`. Left unset it is not sent at all, because a non-reasoning model may reject
   * the parameter. It is configuration, like the model ID, not a gateway constant.
   */
  readonly visionReasoningEffort?: ReasoningEffort;
  readonly apiKey?: string;
  /** Supplied by tests and by D009's load testing. No network call happens. */
  readonly modelResolver?: (modelId: string) => LanguageModel;
  readonly pricing?: Readonly<Record<string, ModelPricing>>;
  readonly retry?: RetryOptions;
  readonly onCall?: (event: CallEvent) => void;
}

export interface CallEvent {
  readonly operation: string;
  readonly model: string;
  readonly usage: Usage;
  readonly attempts: number;
  readonly durationMs: number;
}

export interface ReadPageImageRequest {
  readonly image: Uint8Array;
  readonly mediaType: string;
  readonly prompt: string;
}

function toUsage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  pricing: ModelPricing | undefined,
): Usage {
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;

  return {
    inputTokens: input,
    outputTokens: output,
    // Left undefined rather than guessed. A made-up cost is worse than no cost,
    // because it looks like a measurement.
    costUsd:
      pricing === undefined
        ? undefined
        : (input * pricing.inputPerMillionUsd + output * pricing.outputPerMillionUsd) / 1_000_000,
  };
}

export class Gateway {
  private readonly models: ModelConfig;
  private readonly resolve: (modelId: string) => LanguageModel;
  private readonly pricing: Readonly<Record<string, ModelPricing>>;
  private readonly retry: RetryOptions;
  private readonly onCall: ((event: CallEvent) => void) | undefined;
  private readonly visionReasoningEffort: ReasoningEffort | undefined;

  constructor(options: GatewayOptions = {}) {
    this.visionReasoningEffort = options.visionReasoningEffort;
    this.models = options.models ?? loadModelConfig();
    this.pricing = options.pricing ?? {};
    this.retry = options.retry ?? {};
    this.onCall = options.onCall;

    if (options.modelResolver !== undefined) {
      this.resolve = options.modelResolver;
    } else {
      const openai = createOpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
      this.resolve = (modelId) => openai(modelId);
    }
  }

  /** Reads a rendered page image and returns its text. Used by F004's OCR fallback. */
  async readPageImage(request: ReadPageImageRequest): Promise<GatewayResult<string>> {
    return this.call('readPageImage', this.models.vision, async (model) => {
      const result = await generateText({
        model,
        ...(this.visionReasoningEffort === undefined
          ? {}
          : { providerOptions: { openai: { reasoningEffort: this.visionReasoningEffort } } }),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: request.prompt },
              { type: 'file', data: request.image, mediaType: request.mediaType },
            ],
          },
        ],
      });

      return {
        value: result.text,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      };
    });
  }

  private async call<T>(
    operation: string,
    modelId: string,
    run: (model: LanguageModel) => Promise<{
      value: T;
      inputTokens: number | undefined;
      outputTokens: number | undefined;
    }>,
  ): Promise<GatewayResult<T>> {
    const started = Date.now();
    const model = this.resolve(modelId);

    let outcome;
    try {
      outcome = await withRetry(() => run(model), this.retry);
    } catch (error) {
      throw new GatewayError(
        `${operation} failed against ${modelId}: ${(error as Error).message}`,
        this.retry.maxAttempts ?? 3,
        error,
      );
    }

    const usage = toUsage(
      outcome.value.inputTokens,
      outcome.value.outputTokens,
      this.pricing[modelId],
    );
    const durationMs = Date.now() - started;

    this.onCall?.({ operation, model: modelId, usage, attempts: outcome.attempts, durationMs });

    return {
      value: outcome.value.value,
      usage,
      model: modelId,
      attempts: outcome.attempts,
      durationMs,
    };
  }
}
