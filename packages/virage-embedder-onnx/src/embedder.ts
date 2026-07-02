import type { EmbeddingProvider, Logger } from "@vivantel/virage-core";
import type { OnnxEmbedderOptions } from "./types.js";
import { OnnxTokenizer } from "./tokenizer.js";
import { resolveModel } from "./downloader.js";

// Lazy import of onnxruntime-node to avoid load-time failures when the package
// is not installed (it is a required dependency, but optional at module load time
// to support mock-free testing of other embedder paths).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrtModule = { InferenceSession: any; Tensor: any };
let ortModule: OrtModule | null = null;
async function getOrt(): Promise<OrtModule> {
  if (!ortModule) {
    ortModule = (await import("onnxruntime-node")) as unknown as OrtModule;
  }
  return ortModule!;
}

export class OnnxEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  readonly model: string;
  readonly preferredBatchSize: number;

  private readonly options: OnnxEmbedderOptions;
  private logger: Logger | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any | null = null;
  private tokenizer: OnnxTokenizer | null = null;

  constructor(options: OnnxEmbedderOptions) {
    this.options = options;
    this.dimensions = options.dimensions;
    this.model = options.model;
    this.name = `onnx:${options.model.replace(/[/\\]/g, ":")}`;
    this.preferredBatchSize = 32;
  }

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("onnx-embedder");
  }

  async preWarm(): Promise<void> {
    if (this.session) return;

    const resolved = await resolveModel(
      this.options.model,
      this.options.tokenizerPath,
      this.options.cacheDir,
      (msg) => this.logger?.verbose(msg),
    );

    const ort = await getOrt();
    const sessionOptions: Record<string, unknown> = {
      executionProviders: [this.options.executionProvider ?? "cpu"],
      graphOptimizationLevel:
        this.options.graphOptimizationLevel === undefined
          ? "all"
          : graphOptLevelName(this.options.graphOptimizationLevel),
    };
    if (this.options.numThreads !== undefined) {
      sessionOptions["intraOpNumThreads"] = this.options.numThreads;
    }
    if (this.options.deviceId !== undefined) {
      sessionOptions["deviceId"] = this.options.deviceId;
    }

    this.logger?.debug(
      `Loading ONNX session from ${resolved.modelPath} (${this.options.executionProvider ?? "cpu"})`,
    );
    this.session = await ort.InferenceSession.create(
      resolved.modelPath,
      sessionOptions,
    );

    const maxLen = this.options.maxSequenceLength ?? 512;
    this.tokenizer = await OnnxTokenizer.fromFile(
      resolved.tokenizerPath,
      maxLen,
    );
    this.logger?.debug(
      `ONNX session ready — dimensions: ${this.dimensions}, maxLen: ${maxLen}`,
    );
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.session || !this.tokenizer) {
      await this.preWarm();
    }

    const ort = await getOrt();
    const batch = this.tokenizer!.encodeBatch(texts);
    const batchSize = texts.length;
    const seqLen = batch.maxLength;

    const inputIds = new ort.Tensor(
      "int64",
      BigInt64Array.from(batch.inputIds.flat().map(BigInt)),
      [batchSize, seqLen],
    );
    const attentionMask = new ort.Tensor(
      "int64",
      BigInt64Array.from(batch.attentionMask.flat().map(BigInt)),
      [batchSize, seqLen],
    );
    const tokenTypeIds = new ort.Tensor(
      "int64",
      BigInt64Array.from(batch.tokenTypeIds.flat().map(BigInt)),
      [batchSize, seqLen],
    );

    const feeds: Record<string, unknown> = {
      input_ids: inputIds,
      attention_mask: attentionMask,
      token_type_ids: tokenTypeIds,
    };

    const output = await this.session.run(feeds);
    // Most ONNX sentence transformer models output "last_hidden_state" [B, S, D]
    const lastHidden: number[] = Array.from(
      output["last_hidden_state"]?.data ??
        output[Object.keys(output)[0]]?.data ??
        [],
    ) as number[];

    const pooled: number[][] = [];
    for (let b = 0; b < batchSize; b++) {
      const vec = pool(
        lastHidden,
        batch.attentionMask[b]!,
        b,
        seqLen,
        this.dimensions,
        this.options.pooling ?? "mean",
      );
      pooled.push(this.options.normalize !== false ? l2Normalize(vec) : vec);
    }
    return pooled;
  }
}

function graphOptLevelName(level: 0 | 1 | 2 | 3): string {
  return ["disabled", "basic", "extended", "all"][level]!;
}

function pool(
  data: number[],
  mask: number[],
  batchIdx: number,
  seqLen: number,
  dims: number,
  strategy: "mean" | "cls",
): number[] {
  if (strategy === "cls") {
    const start = batchIdx * seqLen * dims;
    return Array.from(data.slice(start, start + dims));
  }

  // mean pooling: average over non-padding token embeddings
  const result = new Array<number>(dims).fill(0);
  let count = 0;
  for (let s = 0; s < seqLen; s++) {
    if (!mask[s]) continue;
    const offset = (batchIdx * seqLen + s) * dims;
    for (let d = 0; d < dims; d++) {
      result[d]! += data[offset + d]!;
    }
    count++;
  }
  if (count > 0) {
    for (let d = 0; d < dims; d++) result[d]! /= count;
  }
  return result;
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}
