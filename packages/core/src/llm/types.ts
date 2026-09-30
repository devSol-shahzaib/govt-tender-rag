/** What a call cost. Captured for every call so Module 1 has data to trace. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Undefined when the model's price is not configured, never guessed. */
  readonly costUsd: number | undefined;
}

export interface GatewayResult<T> {
  readonly value: T;
  readonly usage: Usage;
  readonly model: string;
  readonly attempts: number;
  readonly durationMs: number;
}

/** Per-million-token prices. Absent means cost is reported as undefined. */
export interface ModelPricing {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
