import { retrieveRelevantKnowledge } from '../retrieval/service';
import { env } from '../../config/env';
import { buildContextBlock, buildConversationHistoryBlock, buildSystemPrompt } from './prompt';
import { getLLMProvider } from './provider';
import { recordAudit } from '../audit/service';

export type AIRequest = {
  organizationId: string;
  message: string;
  conversationContext?: { messages: Array<{ role: 'user' | 'assistant'; content: string }> } | null;
  userId?: string | null;
  language?: string;
};

export type AIResponse = {
  message: string;
  grounded: boolean;
  sources: Array<{ chunkId: string; knowledgeItemId: string; score: number }>;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  meta?: Record<string, unknown>;
};

export async function generateResponse(req: AIRequest): Promise<AIResponse> {
  const provider = getLLMProvider();
  const retrieval = await retrieveRelevantKnowledge({
    organizationId: req.organizationId,
    query: req.message,
    topK: env.RETRIEVAL_TOPK,
    minScore: env.RETRIEVAL_MIN_SCORE,
  });

  const hasKnowledge = (retrieval.results?.length ?? 0) > 0;
  const system = buildSystemPrompt();
  const knowledgeContext = hasKnowledge
    ? buildContextBlock({
        retrievedKnowledge: retrieval.results.map((r) => ({
          content: r.content,
          score: r.score,
          metadata: r.metadata,
        })),
        message: req.message,
      })
    : '';
  const history = (req.conversationContext?.messages ?? []).slice(-env.AI_HISTORY_MESSAGES);
  const historyContext = buildConversationHistoryBlock(history);
  const context = [historyContext, knowledgeContext].filter(Boolean).join('\n\n');

  const llmRes = await provider.generate({
    system,
    context,
    message: req.message,
    temperature: env.AI_TEMPERATURE,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS,
    language: req.language,
    history,
  });

  const grounded = hasKnowledge && !!knowledgeContext;
  const response: AIResponse = {
    message: llmRes.text || (hasKnowledge ? env.AI_FALLBACK_MESSAGE : env.AI_FALLBACK_MESSAGE),
    grounded,
    sources: (retrieval.results || []).map((r) => ({
      chunkId: r.chunkId,
      knowledgeItemId: r.knowledgeItemId,
      score: r.score,
    })),
    usage: llmRes.usage
      ? {
          ...llmRes.usage,
          totalTokens:
            llmRes.usage.totalTokens ??
            (llmRes.usage.inputTokens ?? 0) + (llmRes.usage.outputTokens ?? 0),
        }
      : undefined,
    meta: { model: provider.model },
  };

  await recordAudit({
    organizationId: req.organizationId,
    actorUserId: req.userId ?? undefined,
    action: 'ai.generate.success',
    resourceType: 'ai_conversation',
    resourceId: null,
    metadata: {
      model: provider.model,
      grounded,
      sources: response.sources.length,
    },
  });

  return response;
}
