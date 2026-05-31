import type { EmbeddingProvider } from "../interfaces/index.js";
import { sleep } from "../core/utils.js";

export interface GitHubModelsEmbedderOptions {
  token: string;
  model?: string;
  dimensions?: number;
  endpoint?: string;
  maxRetryWaitMs?: number;
}

export class GitHubModelsEmbedder implements EmbeddingProvider {
  readonly name = "github-models";
  readonly dimensions: number;

  private readonly token: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly maxRetryWaitMs: number;

  constructor(options: GitHubModelsEmbedderOptions) {
    this.token = options.token;
    this.model = options.model ?? "openai/text-embedding-3-small";
    this.dimensions = options.dimensions ?? 1536;
    this.endpoint =
      options.endpoint ?? "https://models.github.ai/inference/embeddings";
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? 5 * 60 * 1000;
  }

  private async request(input: string | string[]): Promise<number[][]> {
    const inputs = Array.isArray(input) ? input : [input];
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ model: this.model, input: inputs }),
    });

    if (res.status === 429) {
      const waitMs =
        parseInt(res.headers.get("retry-after") ?? "60", 10) * 1000;
      if (waitMs > this.maxRetryWaitMs) {
        throw new Error(
          `GitHub Models 429 — retry-after ${waitMs / 1000}s exceeds maxRetryWaitMs ${this.maxRetryWaitMs / 1000}s`,
        );
      }
      console.warn(`⏳ GitHub Models rate limited — waiting ${waitMs / 1000}s`);
      await sleep(waitMs);
      throw new Error("GitHub Models 429 — rate limited");
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GitHub Models ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`,
      );
    }

    const remaining = parseInt(
      res.headers.get("x-ratelimit-remaining") ?? "-1",
      10,
    );
    const reset = parseInt(res.headers.get("x-ratelimit-reset") ?? "0", 10);

    if (remaining === 0 && reset > 0) {
      const waitMs = Math.max(0, reset * 1000 - Date.now()) + 500;
      if (waitMs > this.maxRetryWaitMs) {
        throw new Error(
          `GitHub Models rate limit exhausted — reset in ${Math.ceil(waitMs / 1000)}s exceeds maxRetryWaitMs ${this.maxRetryWaitMs / 1000}s`,
        );
      }
      console.warn(
        `⏳ Rate limit window exhausted — waiting ${Math.ceil(waitMs / 1000)}s`,
      );
      await sleep(waitMs);
    } else if (remaining >= 0) {
      console.log(`  📊 GitHub Models: ${remaining} requests remaining`);
    }

    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => d.embedding);
  }

  async embed(text: string): Promise<number[]> {
    return (await this.request(text))[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.request(texts);
  }
}
