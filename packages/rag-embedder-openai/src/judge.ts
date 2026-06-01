import type { LLMJudge } from "@vivantel/rag-core";
import OpenAI from "openai";

export interface OpenAIJudgeOptions {
  apiKey: string;
  /** Defaults to "gpt-4o-mini" */
  model?: string;
  baseURL?: string;
  maxRetries?: number;
}

// RAGAS-style prompt templates
// Reference: https://docs.ragas.io/en/stable/concepts/metrics/

const FAITHFULNESS_PROMPT = (
  contexts: string[],
  answer: string,
) => `You are evaluating RAG faithfulness. Given the retrieved context and an answer, score from 0.0 to 1.0 how much the answer is grounded in the context (1.0 = fully grounded, 0.0 = completely hallucinated).

CONTEXT:
${contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")}

ANSWER:
${answer}

Respond with ONLY a JSON object: {"score": <number>}`;

const ANSWER_RELEVANCE_PROMPT = (
  query: string,
  answer: string,
) => `You are evaluating RAG answer relevance. Given the query and the answer, score from 0.0 to 1.0 how well the answer addresses the question (1.0 = perfectly on-topic, 0.0 = completely irrelevant).

QUERY:
${query}

ANSWER:
${answer}

Respond with ONLY a JSON object: {"score": <number>}`;

const CONTEXT_RECALL_PROMPT = (
  groundTruth: string,
  contexts: string[],
) => `You are evaluating RAG context recall. Given the expected answer and the retrieved contexts, score from 0.0 to 1.0 how much information from the expected answer is covered by the contexts (1.0 = fully covered, 0.0 = not covered at all).

EXPECTED ANSWER:
${groundTruth}

RETRIEVED CONTEXTS:
${contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")}

Respond with ONLY a JSON object: {"score": <number>}`;

export class OpenAIJudge implements LLMJudge {
  readonly name: string;

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIJudgeOptions) {
    this.model = options.model ?? "gpt-4o-mini";
    this.name = `openai-judge:${this.model}`;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      maxRetries: options.maxRetries ?? 3,
    });
  }

  async evaluate(
    query: string,
    contexts: string[],
    groundTruth: string,
  ): Promise<{
    faithfulness: number;
    answerRelevance: number;
    contextRecall: number;
  }> {
    // Use ground truth as the "answer" for faithfulness and relevance evaluation
    const [faithfulness, answerRelevance, contextRecall] = await Promise.all([
      this.score(FAITHFULNESS_PROMPT(contexts, groundTruth)),
      this.score(ANSWER_RELEVANCE_PROMPT(query, groundTruth)),
      this.score(CONTEXT_RECALL_PROMPT(groundTruth, contexts)),
    ]);

    return { faithfulness, answerRelevance, contextRecall };
  }

  private async score(prompt: string): Promise<number> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(content) as { score?: number };
      const score = parsed.score;
      if (typeof score !== "number") return 0;
      return Math.max(0, Math.min(1, score));
    } catch {
      return 0;
    }
  }
}
