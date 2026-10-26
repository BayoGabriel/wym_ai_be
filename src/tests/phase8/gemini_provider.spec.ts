import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Phase 8: GeminiProvider', () => {
  const mockGenerateContent = vi.fn();
  const mockEnv = {
    AI_PROVIDER: 'GEMINI' as const,
    AI_MODEL: 'gemini-2.5-flash',
    AI_TEMPERATURE: 0.2,
    AI_MAX_OUTPUT_TOKENS: 512,
    AI_FALLBACK_MESSAGE: 'Fallback message.',
    GEMINI_API_KEY: 'test-api-key-for-tests',
    AI_REQUEST_TIMEOUT_MS: 5000,
    RETRIEVAL_TOPK: 5,
    RETRIEVAL_MIN_SCORE: 0,
    AI_MAX_CHUNKS: 6,
    AI_MAX_CONTEXT_CHARS: 8000,
    AI_HISTORY_MESSAGES: 12,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockReturnValue({
        models: {
          generateContent: mockGenerateContent,
        },
      }),
    }));

    vi.doMock('../../config/env', () => ({
      env: { ...mockEnv },
    }));
  });

  afterEach(() => {
    vi.doUnmock('@google/genai');
    vi.doUnmock('../../config/env');
    vi.restoreAllMocks();
  });

  it('selects GeminiProvider when AI_PROVIDER is GEMINI', async () => {
    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();
    expect(provider.name).toBe('GEMINI');
    expect(provider.model).toBe('gemini-2.5-flash');
  });

  it('constructs correct request payload with system instruction and message', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Test response',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    });

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();
    const result = await provider.generate({
      system: 'You are an assistant.',
      context: 'ORGANIZATION KNOWLEDGE:\nFAQ content here.',
      message: 'What are your hours?',
      temperature: 0.3,
      maxTokens: 256,
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateContent.mock.calls[0][0];

    // System instruction combines system + context
    expect(callArgs.config.systemInstruction).toContain('You are an assistant.');
    expect(callArgs.config.systemInstruction).toContain('ORGANIZATION KNOWLEDGE');

    // Contents has user message
    expect(callArgs.contents).toHaveLength(1);
    expect(callArgs.contents[0].role).toBe('user');
    expect(callArgs.contents[0].parts[0].text).toBe('What are your hours?');

    // Config values
    expect(callArgs.config.temperature).toBe(0.3);
    expect(callArgs.config.maxOutputTokens).toBe(256);
    expect(callArgs.model).toBe('gemini-2.5-flash');

    // Result
    expect(result.text).toBe('Test response');
  });

  it('maps conversation history correctly with user/model roles', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Follow-up answer',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 8,
        totalTokenCount: 28,
      },
    });

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();
    await provider.generate({
      system: 'System prompt',
      context: '',
      message: 'Follow-up question',
      history: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
      ],
    });

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.contents).toHaveLength(3);
    expect(callArgs.contents[0].role).toBe('user');
    expect(callArgs.contents[0].parts[0].text).toBe('First question');
    expect(callArgs.contents[1].role).toBe('model');
    expect(callArgs.contents[1].parts[0].text).toBe('First answer');
    expect(callArgs.contents[2].role).toBe('user');
    expect(callArgs.contents[2].parts[0].text).toBe('Follow-up question');
  });

  it('extracts usage metadata correctly', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Response',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      },
    });

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();
    const result = await provider.generate({
      system: 'sys',
      context: 'ctx',
      message: 'msg',
    });

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it('handles missing usage metadata gracefully', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Response',
      candidates: [{ finishReason: 'STOP' }],
    });

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();
    const result = await provider.generate({
      system: 'sys',
      context: 'ctx',
      message: 'msg',
    });

    expect(result.usage).toBeUndefined();
    expect(result.text).toBe('Response');
  });

  it('handles empty/blocked responses safely', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '',
      candidates: [{ finishReason: 'SAFETY' }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 0,
        totalTokenCount: 10,
      },
    });

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();
    const result = await provider.generate({
      system: 'sys',
      context: 'ctx',
      message: 'msg',
    });

    expect(result.text).toBe('');
    expect(result.raw).toEqual({ finishReason: 'SAFETY' });
    expect(result.usage?.inputTokens).toBe(10);
  });

  it('wraps provider errors without leaking API keys', async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error('Request failed: key=AIzaSyBadKey123 invalid')
    );

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();

    try {
      await provider.generate({ system: 'sys', context: 'ctx', message: 'msg' });
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      const err = e as Error & { code?: string };
      expect(err.message).toContain('Gemini provider error');
      expect(err.message).not.toContain('AIzaSyBadKey123');
      expect(err.message).toContain('key=***');
      expect(err.code).toBe('PROVIDER_ERROR');
    }
  });

  it('handles timeout via AbortController', async () => {
    mockGenerateContent.mockImplementationOnce(() => {
      const err = new DOMException('The operation was aborted', 'AbortError');
      return Promise.reject(err);
    });

    const { getLLMProvider } = await import('../../modules/ai/provider');
    const provider = getLLMProvider();

    try {
      await provider.generate({ system: 'sys', context: 'ctx', message: 'msg' });
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      const err = e as Error & { code?: string };
      expect(err.message).toContain('timed out');
      expect(err.code).toBe('PROVIDER_TIMEOUT');
    }
  });
});
