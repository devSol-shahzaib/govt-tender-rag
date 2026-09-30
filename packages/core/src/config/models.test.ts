import { describe, expect, it } from 'vitest';
import { loadModelConfig, modelFor } from './models.js';

const validEnv = {
  OPENAI_MAIN_MODEL: 'main-model-id',
  OPENAI_CHEAP_MODEL: 'cheap-model-id',
  OPENAI_EMBEDDING_MODEL: 'embedding-model-id',
  OPENAI_VISION_MODEL: 'vision-model-id',
};

describe('loadModelConfig', () => {
  it('reads all three model IDs from the environment', () => {
    expect(loadModelConfig(validEnv)).toEqual({
      main: 'main-model-id',
      cheap: 'cheap-model-id',
      embedding: 'embedding-model-id',
      vision: 'vision-model-id',
    });
  });

  it('names the missing variable without printing any value', () => {
    const { OPENAI_CHEAP_MODEL, ...incomplete } = validEnv;

    expect(() => loadModelConfig(incomplete)).toThrowError(/OPENAI_CHEAP_MODEL/);
    expect(() => loadModelConfig(incomplete)).not.toThrowError(new RegExp(OPENAI_CHEAP_MODEL));
  });

  it('rejects an empty model ID rather than passing it on', () => {
    expect(() => loadModelConfig({ ...validEnv, OPENAI_MAIN_MODEL: '' })).toThrowError(
      /OPENAI_MAIN_MODEL/,
    );
  });
});

describe('modelFor', () => {
  const config = loadModelConfig(validEnv);

  it('resolves each tier to its model ID', () => {
    expect(modelFor('main', config)).toBe('main-model-id');
    expect(modelFor('cheap', config)).toBe('cheap-model-id');
  });

  it('rejects an unknown tier and lists the valid ones', () => {
    expect(() => modelFor('expensive', config)).toThrowError(
      /Unknown model tier "expensive"\. Expected one of: main, cheap/,
    );
  });
});
