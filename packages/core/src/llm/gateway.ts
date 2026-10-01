import { createOpenAI } from '@ai-sdk/openai';
import { embedMany, generateText, type EmbeddingModel, type LanguageModel } from 'ai';
import { z } from 'zod';
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
  /** The embedding counterpart of modelResolver. */
  readonly embeddingModelResolver?: (modelId: string) => EmbeddingModel;
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

export interface EmbedChunksRequest {
  readonly texts: readonly string[];
  /**
   * The length every vector must have. Supplied by the caller because it is a property
   * of where the vectors go, the database column, and a response that would not fit
   * there must fail here rather than at insert.
   */
  readonly dimensions: number;
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

/**
 * One vector per input, each of the expected length, every value a finite number (Zod 4
 * rejects NaN and Infinity in z.number()). A provider response is an external boundary.
 */
function embeddingsSchema(count: number, dimensions: number) {
  return z.array(z.array(z.number()).length(dimensions)).length(count);
}

export class Gateway {
  private readonly models: ModelConfig;
  private readonly resolve: (modelId: string) => LanguageModel;
  private readonly resolveEmbedding: (modelId: string) => EmbeddingModel;
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

    // Created lazily: a gateway built entirely from resolvers, as in tests, never needs it.
    let openai: ReturnType<typeof createOpenAI> | undefined;
    const provider = () =>
      (openai ??= createOpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY }));

    this.resolve = options.modelResolver ?? ((modelId) => provider()(modelId));
    this.resolveEmbedding =
      options.embeddingModelResolver ?? ((modelId) => provider().embedding(modelId));
  }

  /**
   * The model embedChunks uses. Callers record it next to each vector and select
   * chunks made by any other model, before making a call.
   */
  get embeddingModel(): string {
    return this.models.embedding;
  }

  /**
   * Embeds chunk texts with the configured embedding model, in input order.
   *
   * One request per call: batching across requests is the caller's decision, since it
   * owns what a failed batch means. The SDK's own retries are off so that retry lives in
   * one place, here.
   */
  async embedChunks(request: EmbedChunksRequest): Promise<GatewayResult<number[][]>> {
    if (request.texts.length === 0) {
      throw new Error('embedChunks needs at least one text; an empty batch is a caller bug.');
    }

    const modelId = this.models.embedding;
    const result = await this.call(
      'embedChunks',
      modelId,
      this.resolveEmbedding(modelId),
      async (model) => {
        const response = await embedMany({
          model,
          values: [...request.texts],
          maxRetries: 0,
          maxParallelCalls: 1,
        });

        return {
          value: response.embeddings,
          inputTokens: response.usage.tokens,
          outputTokens: 0,
        };
      },
    );

    // Checked after the call, outside retry: a malformed response is not a transient
    // failure, and asking again would pay twice for the same wrong answer.
    const parsed = embeddingsSchema(request.texts.length, request.dimensions).safeParse(
      result.value,
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new GatewayError(
        `embedChunks returned unusable vectors from ${modelId} for ${String(request.texts.length)} ` +
          `texts at ${String(request.dimensions)} dimensions: ${issue?.message ?? 'invalid'} ` +
          `at ${issue?.path.join('.') ?? '?'}`,
        result.attempts,
      );
    }

    return { ...result, value: parsed.data };
  }

  /** Reads a rendered page image and returns its text. Used by F004's OCR fallback. */
  async readPageImage(request: ReadPageImageRequest): Promise<GatewayResult<string>> {
    const modelId = this.models.vision;
    return this.call('readPageImage', modelId, this.resolve(modelId), async (model) => {
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

  /**
   * The model is resolved once by the caller, not per attempt, so a retry reuses the
   * same client rather than building a new one.
   */
  private async call<M, T>(
    operation: string,
    modelId: string,
    model: M,
    run: (model: M) => Promise<{
      value: T;
      inputTokens: number | undefined;
      outputTokens: number | undefined;
    }>,
  ): Promise<GatewayResult<T>> {
    const started = Date.now();

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
