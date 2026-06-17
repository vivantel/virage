import type { Reranker, VectorSearchResult } from "@vivantel/virage-core";
import Anthropic from "@anthropic-ai/sdk";

export interface LlmRerankerOptions {
  /** Anthropic model ID. Defaults to "claude-haiku-4-5". */
  model?: string;
  /** API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Number of results to return after re-ranking. Defaults to 5. */
  topK?: number;
}

const RANK_PROMPT = (
  query: string,
  docs: string[],
) => `You are a relevance ranking assistant. Given the query and a list of document excerpts numbered 0 to ${docs.length - 1}, return a JSON array of indices in order from most relevant to least relevant.

Query: ${query}

Documents:
${docs.map((d, i) => `[${i}] ${d.slice(0, 300)}`).join("\n\n")}

Respond with ONLY a JSON array of indices, e.g. [2, 0, 1]. No explanation.`;

export class LlmReranker implements Reranker {
  readonly name = "llm";

  private readonly modelId: string;
  private readonly defaultTopK: number;
  private readonly client: Anthropic;

  constructor(options: LlmRerankerOptions = {}) {
    this.modelId = options.model ?? "claude-haiku-4-5";
    this.defaultTopK = options.topK ?? 5;
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async rerank(
    query: string,
    candidates: VectorSearchResult[],
    topK?: number,
  ): Promise<VectorSearchResult[]> {
    if (candidates.length === 0) return [];
    const k = topK ?? this.defaultTopK;

    let indices: number[];
    try {
      const message = await this.client.messages.create({
        model: this.modelId,
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: RANK_PROMPT(
              query,
              candidates.map((c) => c.content),
            ),
          },
        ],
      });
      const text =
        message.content[0]?.type === "text" ? message.content[0].text : "[]";
      const match = text.match(/\[[\d,\s]+\]/);
      indices = match ? (JSON.parse(match[0]) as number[]) : [];
    } catch {
      // Fall back to original order on error
      return candidates.slice(0, k);
    }

    // Build reranked list: LLM-ordered first, then any remaining not mentioned
    const seen = new Set<number>();
    const reranked: VectorSearchResult[] = [];
    for (const idx of indices) {
      if (idx >= 0 && idx < candidates.length && !seen.has(idx)) {
        const score = 1 - reranked.length / candidates.length;
        reranked.push({ ...candidates[idx], similarity: score });
        seen.add(idx);
      }
    }
    for (let i = 0; i < candidates.length; i++) {
      if (!seen.has(i)) {
        reranked.push(candidates[i]);
      }
    }
    return reranked.slice(0, k);
  }
}
