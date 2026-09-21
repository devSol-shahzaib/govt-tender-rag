import { z } from 'zod';

/**
 * Model tiers from D012. The gateway routes cheap work (query rewriting,
 * classification) to the cheap tier and grounded answers to the main tier.
 */
export const MODEL_TIERS = ['main', 'cheap'] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

export interface ModelConfig {
  readonly main: string;
  readonly cheap: string;
  readonly embedding: string;
}

const modelEnvSchema = z.object({
  OPENAI_MAIN_MODEL: z.string().min(1),
  OPENAI_CHEAP_MODEL: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().min(1),
});

/**
 * Reads model IDs from the environment. CLAUDE.md forbids hard-coding them in
 * feature code, so this is the only place they enter the system.
 *
 * Reports the names of variables that failed, never their values, matching the
 * env handling in the server.
 */
export function loadModelConfig(
  env: Record<string, string | undefined> = process.env,
): ModelConfig {
  const parsed = modelEnvSchema.safeParse(env);

  if (!parsed.success) {
    const invalid = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid model configuration: ${invalid}`);
  }

  return {
    main: parsed.data.OPENAI_MAIN_MODEL,
    cheap: parsed.data.OPENAI_CHEAP_MODEL,
    embedding: parsed.data.OPENAI_EMBEDDING_MODEL,
  };
}

function isModelTier(value: string): value is ModelTier {
  return (MODEL_TIERS as readonly string[]).includes(value);
}

/**
 * Resolves a tier to a model ID. Takes a string rather than a ModelTier because
 * tiers arriving from config or a request body are unvalidated at runtime, and a
 * typo should fail loudly here instead of reaching the provider as undefined.
 */
export function modelFor(tier: string, config: ModelConfig): string {
  if (!isModelTier(tier)) {
    throw new Error(`Unknown model tier "${tier}". Expected one of: ${MODEL_TIERS.join(', ')}`);
  }

  return config[tier];
}
