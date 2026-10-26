import { env } from '../../config/env';
import { GoogleGenAI } from '@google/genai';

export interface LLMResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  raw?: unknown;
}

export interface LLMGenerateInput {
  system: string;
  context: string;
  message: string;
  temperature?: number;
  maxTokens?: number;
  language?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate(input: LLMGenerateInput): Promise<LLMResponse>;
}

class LocalFakeProvider implements LLMProvider {
  readonly name = 'LOCAL_FAKE';
  readonly model = env.AI_MODEL;
  async generate(input: LLMGenerateInput): Promise<LLMResponse> {
    const ctxPreview = (input.context || '').slice(0, 600);
    const grounded = input.context.includes('ORGANIZATION KNOWLEDGE');
    const text = grounded
      ? `Based on the provided organization knowledge, here is a helpful answer:\n\n${ctxPreview}\n\nAnswer: ${input.message}`
      : env.AI_FALLBACK_MESSAGE;
    return {
      text,
      usage: {
        inputTokens: Math.ceil(
          (input.system.length + input.context.length + input.message.length) / 4
        ),
        outputTokens: Math.ceil(text.length / 4),
      },
    };
  }
}

class GeminiProvider implements LLMProvider {
  readonly name = 'GEMINI';
  readonly model: string;
  private client: GoogleGenAI;
  private timeoutMs: number;

  constructor() {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required when AI_PROVIDER is GEMINI');
    }
    this.model = env.AI_MODEL;
    this.client = new GoogleGenAI({ apiKey });
    this.timeoutMs = env.AI_REQUEST_TIMEOUT_MS;
  }

  async generate(input: LLMGenerateInput): Promise<LLMResponse> {
    const systemInstruction = [input.system, input.context].filter(Boolean).join('\n\n');

    // Build contents: history + current message
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    if (input.history?.length) {
      for (const msg of input.history) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: input.message }],
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction,
          temperature: input.temperature,
          maxOutputTokens: input.maxTokens,
          abortSignal: controller.signal,
        },
      });

      const text = response.text ?? '';

      if (!text && response.candidates?.[0]?.finishReason) {
        const reason = response.candidates[0].finishReason;
        const blockedReasons = [
          'SAFETY',
          'BLOCKLIST',
          'PROHIBITED_CONTENT',
          'SPII',
          'IMAGE_SAFETY',
        ];
        if (blockedReasons.includes(String(reason))) {
          return {
            text: '',
            usage: this.extractUsage(response),
            raw: { finishReason: String(reason) },
          };
        }
      }

      return {
        text,
        usage: this.extractUsage(response),
        raw: { finishReason: String(response.candidates?.[0]?.finishReason ?? '') },
      };
    } catch (err: unknown) {
      throw this.wrapError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  private extractUsage(response: {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  }): LLMResponse['usage'] {
    const meta = response.usageMetadata;
    if (!meta) return undefined;
    return {
      inputTokens: meta.promptTokenCount,
      outputTokens: meta.candidatesTokenCount,
      totalTokens: meta.totalTokenCount,
    };
  }

  private wrapError(err: unknown): Error & { code: string } {
    if (err instanceof DOMException && err.name === 'AbortError') {
      const e = Object.assign(new Error(`Gemini request timed out after ${this.timeoutMs}ms`), {
        code: 'PROVIDER_TIMEOUT',
      });
      return e;
    }
    const message = err instanceof Error ? err.message : String(err);
    // Sanitize: strip anything that looks like an API key
    const sanitized = message.replace(/key=[A-Za-z0-9_-]+/g, 'key=***');
    return Object.assign(new Error(`Gemini provider error: ${sanitized}`), {
      code: 'PROVIDER_ERROR',
    });
  }
}

export function getLLMProvider(): LLMProvider {
  switch (env.AI_PROVIDER) {
    case 'GEMINI':
      return new GeminiProvider();
    case 'LOCAL_FAKE':
    default:
      return new LocalFakeProvider();
  }
}
