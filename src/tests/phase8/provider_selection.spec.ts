import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Phase 8: Provider selection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../../config/env');
    vi.doUnmock('@google/genai');
    vi.restoreAllMocks();
  });

  it('selects LOCAL_FAKE when AI_PROVIDER is LOCAL_FAKE', async () => {
    vi.doMock('../../config/env', () => ({
      env: {
        AI_PROVIDER: 'LOCAL_FAKE',
        AI_MODEL: 'local-fake',
        AI_TEMPERATURE: 0.2,
        AI_MAX_OUTPUT_TOKENS: 512,
        AI_FALLBACK_MESSAGE: 'Fallback.',
        AI_MAX_CHUNKS: 6,
        AI_MAX_CONTEXT_CHARS: 8000,
        AI_HISTORY_MESSAGES: 12,
      },
    }));

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();
    expect(provider.name).toBe('LOCAL_FAKE');
    expect(provider.model).toBe('local-fake');
  });

  it('LOCAL_FAKE returns deterministic response with grounding', async () => {
    vi.doMock('../../config/env', () => ({
      env: {
        AI_PROVIDER: 'LOCAL_FAKE',
        AI_MODEL: 'local-fake',
        AI_TEMPERATURE: 0.2,
        AI_MAX_OUTPUT_TOKENS: 512,
        AI_FALLBACK_MESSAGE: 'Fallback message for test.',
        AI_MAX_CHUNKS: 6,
        AI_MAX_CONTEXT_CHARS: 8000,
        AI_HISTORY_MESSAGES: 12,
      },
    }));

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();

    // With knowledge context
    const grounded = await provider.generate({
      system: 'System prompt',
      context: 'ORGANIZATION KNOWLEDGE (authoritative):\n\nOur hours are 9-5.',
      message: 'What are your hours?',
    });
    expect(grounded.text).toContain('ORGANIZATION KNOWLEDGE');
    expect(grounded.usage).toBeDefined();
    expect(grounded.usage!.inputTokens).toBeGreaterThan(0);
    expect(grounded.usage!.outputTokens).toBeGreaterThan(0);

    // Without knowledge context
    const fallback = await provider.generate({
      system: 'System prompt',
      context: '',
      message: 'Random question',
    });
    expect(fallback.text).toBe('Fallback message for test.');
  });

  it('throws when GEMINI selected without API key', async () => {
    vi.doMock('../../config/env', () => ({
      env: {
        AI_PROVIDER: 'GEMINI',
        AI_MODEL: 'gemini-2.5-flash',
        AI_TEMPERATURE: 0.2,
        AI_MAX_OUTPUT_TOKENS: 512,
        AI_FALLBACK_MESSAGE: 'Fallback.',
        GEMINI_API_KEY: undefined,
        AI_REQUEST_TIMEOUT_MS: 5000,
      },
    }));
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockReturnValue({
        models: { generateContent: vi.fn() },
      }),
    }));

    const { getLLMProvider } = await import('../../modules/ai/provider');
    expect(() => getLLMProvider()).toThrow('GEMINI_API_KEY is required');
  });
});
