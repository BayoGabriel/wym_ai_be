import { env } from '../../config/env';

export interface EmbeddingProvider {
  dimensions: number;
  model: string;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}

// Simple deterministic local embedding (non-LLM) suitable for tests and MVP wiring
export class LocalSimhashEmbedding implements EmbeddingProvider {
  dimensions: number;
  model: string;
  constructor(dim = env.EMBEDDING_DIMENSIONS, model = env.EMBEDDING_MODEL) {
    this.dimensions = dim;
    this.model = model;
  }
  async generateEmbedding(text: string): Promise<number[]> {
    const vec = new Array(this.dimensions).fill(0);
    const tokens = (text || '').toLowerCase().split(/\s+/g).filter(Boolean);
    for (const t of tokens) {
      const h = this.hash(t);
      for (let i = 0; i < this.dimensions; i++) vec[i] += (h >>> (i % 32)) & 1 ? 1 : -1;
    }
    // sign to 0/1 then normalize to unit length
    const signed: number[] = vec.map((v) => (v >= 0 ? 1 : 0));
    let sumsq = 0;
    for (let i = 0; i < signed.length; i++) sumsq += signed[i] * signed[i];
    const norm = Math.sqrt(sumsq) || 1;
    return signed.map((x) => x / norm);
  }
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) out.push(await this.generateEmbedding(t));
    return out;
  }
  private hash(s: string) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  // Only LOCAL in this phase
  return new LocalSimhashEmbedding();
}
