import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(8).max(14).default(10),
  MAX_KNOWLEDGE_DOCUMENT_SIZE_MB: z.coerce.number().int().positive().default(10),
  MAX_KNOWLEDGE_TEXT_LENGTH: z.coerce.number().int().positive().default(20000),
  KNOWLEDGE_CHUNK_SIZE: z.coerce.number().int().positive().default(1200),
  KNOWLEDGE_CHUNK_OVERLAP: z.coerce.number().int().min(0).max(400).default(150),
  EMBEDDING_PROVIDER: z.enum(['LOCAL']).default('LOCAL'),
  EMBEDDING_MODEL: z.string().default('local-simhash'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(384),
  RETRIEVAL_TOPK: z.coerce.number().int().positive().default(5),
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0),
  AI_PROVIDER: z.enum(['LOCAL_FAKE', 'GEMINI']).default('LOCAL_FAKE'),
  AI_MODEL: z.string().default('local-fake'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(512),
  GEMINI_API_KEY: z.string().min(1).optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AI_MAX_CHUNKS: z.coerce.number().int().positive().default(6),
  AI_MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(8000),
  AI_HISTORY_MESSAGES: z.coerce.number().int().positive().default(12),
  AI_FALLBACK_MESSAGE: z
    .string()
    .default(
      "I don't have enough information to answer that accurately. Would you like me to connect you with the team?"
    ),
  PUBLIC_CHAT_SESSION_TTL_HOURS: z.coerce.number().positive().default(24),
  PUBLIC_CHAT_MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(2000),
  PUBLIC_CHAT_SESSION_CREATE_MAX: z.coerce.number().int().positive().default(10),
  PUBLIC_CHAT_SESSION_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  PUBLIC_CHAT_MESSAGE_MAX: z.coerce.number().int().positive().default(30),
  PUBLIC_CHAT_READ_MAX: z.coerce.number().int().positive().default(60),
  PUBLIC_CHAT_LEAD_MAX: z.coerce.number().int().positive().default(5),
  PUBLIC_CHAT_HANDOFF_MAX: z.coerce.number().int().positive().default(5),
  PUBLIC_CHAT_HANDOFF_ACK_MESSAGE: z
    .string()
    .min(1)
    .default(
      'Thanks — your request has been passed to our team and a human agent will reply shortly.'
    ),
  PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  PUBLIC_CHAT_REQUIRE_ORIGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PUBLIC_CHAT_CORS_ORIGINS: z
    .string()
    .default('')
    .superRefine((v, ctx) => {
      for (const entry of v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)) {
        let url: URL;
        try {
          url = new URL(entry);
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid CORS origin: ${entry}` });
          continue;
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `CORS origin must be http(s): ${entry}`,
          });
        }
        if (entry !== url.origin) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `CORS origin must be a bare origin (scheme://host[:port]), got: ${entry}`,
          });
        }
      }
    }),
  TRUST_PROXY: z
    .union([z.literal('true'), z.literal('false'), z.coerce.number().int().min(0)])
    .default('false')
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : v)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  // Avoid printing full details in production logs beyond startup
  throw new Error('Environment validation failed. Check required variables.');
}

export const env = parsed.data;
