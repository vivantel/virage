import type { EmbeddingProvider, Logger } from "@vivantel/virage-core";
import { createRequire } from "node:module";
import { platform, arch } from "node:process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);

const PLATFORM_STUBS: Record<string, string> = {
  "linux-x64": "@vivantel/virage-embedder-onnx-linux-x64-gnu",
  "linux-arm64": "@vivantel/virage-embedder-onnx-linux-arm64-gnu",
  "darwin-x64": "@vivantel/virage-embedder-onnx-darwin-x64",
  "darwin-arm64": "@vivantel/virage-embedder-onnx-darwin-arm64",
  "win32-x64": "@vivantel/virage-embedder-onnx-win32-x64-msvc",
};

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

interface NativeEmbedder {
  embed(text: string): Float32Array;
  embedBatch(texts: string[]): Float32Array;
  readonly dimensions: number;
}

interface NativeBinding {
  OnnxEmbedder: new (
    modelPath: string,
    tokenizerPath: string,
    dimensions: number,
    maxLength?: number,
    pooling?: string,
    normalize?: boolean,
  ) => NativeEmbedder;
}

function loadBinding(): NativeBinding {
  try {
    return require("./virage_embedder_onnx.node") as NativeBinding;
  } catch {
    /* fall through to platform stub */
  }
  const key = `${platform}-${arch}`;
  const stubPkg = PLATFORM_STUBS[key];
  if (stubPkg) {
    try {
      return require(stubPkg) as NativeBinding;
    } catch {
      /* stub not installed */
    }
  }
  const hint = stubPkg ? `\n  npm install ${stubPkg}` : "";
  throw new Error(
    `[@vivantel/virage-embedder-onnx] Native binary not found for ${key}.${hint}\nOr compile from source: npx napi build --release`,
  );
}

export interface OnnxEmbedderOptions {
  /** Local path to model.onnx OR HuggingFace model ID for auto-download. */
  model: string;
  /** Override tokenizer.json path if not co-located with the model. */
  tokenizerPath?: string;
  /** Output vector dimensions — must match the model. */
  dimensions: number;
  /** Max token sequence length. Default 512. */
  maxSequenceLength?: number;
  /** "mean" (default) or "cls" pooling. */
  pooling?: "mean" | "cls";
  /** L2-normalize output vectors. Default true. */
  normalize?: boolean;
  /** Download cache for HuggingFace models. Default ~/.virage/models. */
  cacheDir?: string;
}

function resolveLocalModel(
  model: string,
  tokenizerOverride?: string,
): { modelPath: string; tokenizerPath: string } | null {
  if (model.startsWith("/") || existsSync(model)) {
    const modelPath = existsSync(join(model, "model.onnx"))
      ? join(model, "model.onnx")
      : model;
    return {
      modelPath,
      tokenizerPath: tokenizerOverride ?? join(model, "tokenizer.json"),
    };
  }
  return null;
}

function defaultCacheDir(): string {
  return (
    process.env["VIRAGE_MODELS_DIR"] ?? join(homedir(), ".virage", "models")
  );
}

function cachedModelPaths(
  modelId: string,
  tokenizerOverride: string | undefined,
  cacheDir: string,
): { modelPath: string; tokenizerPath: string } {
  const safe = modelId.replace(/[/\\]/g, "--");
  const dir = join(cacheDir, safe);
  return {
    modelPath: join(dir, "model.onnx"),
    tokenizerPath: tokenizerOverride ?? join(dir, "tokenizer.json"),
  };
}

async function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: ((loaded: number, total: number) => void) | undefined,
  log: (msg: string) => void,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    log(`Downloading ${url}`);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return false;
    const total = Number(res.headers.get("content-length") ?? 0);
    const reader = res.body!.getReader();
    const { writeFile } = await import("node:fs/promises");
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
    await writeFile(dest, Buffer.concat(chunks));
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadIfMissing(
  modelId: string,
  paths: { modelPath: string; tokenizerPath: string },
  onProgress: ((loaded: number, total: number) => void) | undefined,
  log: (msg: string) => void,
): Promise<void> {
  const { mkdirSync } = await import("node:fs");
  const { writeFile } = await import("node:fs/promises");
  const dir = join(paths.modelPath, "..");
  mkdirSync(dir, { recursive: true });

  const base = `https://huggingface.co/${modelId}/resolve/main`;

  if (!existsSync(paths.modelPath)) {
    // Try root model.onnx first; fall back to onnx/ subdir (Xenova-format repos)
    const candidates = [`${base}/model.onnx`, `${base}/onnx/model.onnx`];
    let saved = false;
    for (const url of candidates) {
      // Scale model download to 0–90% of the progress range
      const wrappedProgress = onProgress
        ? (loaded: number, total: number) => onProgress(loaded * 9, total * 10)
        : undefined;
      saved = await downloadWithProgress(
        url,
        paths.modelPath,
        wrappedProgress,
        log,
      );
      if (saved) break;
    }
    if (!saved)
      throw new Error(
        `Failed to download model for ${modelId}: tried ${candidates.join(", ")}`,
      );
  }

  if (!existsSync(paths.tokenizerPath)) {
    const url = `${base}/tokenizer.json`;
    log(`Downloading ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
      await writeFile(
        paths.tokenizerPath,
        Buffer.from(await res.arrayBuffer()),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OnnxEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  readonly model: string;
  readonly preferredBatchSize = 32;

  private readonly opts: OnnxEmbedderOptions;
  private logger: Logger | null = null;
  private native: NativeEmbedder | null = null;

  constructor(opts: OnnxEmbedderOptions) {
    this.opts = opts;
    this.dimensions = opts.dimensions;
    this.model = opts.model;
    this.name = `onnx:${opts.model.replace(/[/\\]/g, ":")}`;
  }

  setLogger(logger: Logger): void {
    this.logger = logger.withTag("onnx-embedder");
  }

  async preWarm(
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    if (this.native) return;

    const local = resolveLocalModel(this.opts.model, this.opts.tokenizerPath);
    let paths: { modelPath: string; tokenizerPath: string };

    if (local) {
      paths = local;
    } else {
      const cacheDir = this.opts.cacheDir ?? defaultCacheDir();
      paths = cachedModelPaths(
        this.opts.model,
        this.opts.tokenizerPath,
        cacheDir,
      );
      await downloadIfMissing(
        this.opts.model,
        paths,
        onProgress,
        (msg) => this.logger?.verbose(msg) ?? console.log(msg),
      );
    }

    // Yield to the event loop so the progress bar can re-render before the
    // synchronous NAPI constructor blocks it.
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.logger?.verbose(`Loading ONNX model: ${paths.modelPath}`);
    const binding = loadBinding();
    this.native = new binding.OnnxEmbedder(
      paths.modelPath,
      paths.tokenizerPath,
      this.opts.dimensions,
      this.opts.maxSequenceLength,
      this.opts.pooling,
      this.opts.normalize,
    );
    this.logger?.debug(`ONNX session ready (dims=${this.dimensions})`);
    onProgress?.(1, 1);
  }

  async embed(text: string): Promise<number[]> {
    if (!this.native) await this.preWarm();
    return Array.from(this.native!.embed(text));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.native) await this.preWarm();
    const flat = Array.from(this.native!.embedBatch(texts));
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(flat.slice(i * this.dimensions, (i + 1) * this.dimensions));
    }
    return result;
  }
}

export function createEmbedder(
  config: Record<string, unknown>,
): EmbeddingProvider {
  const model = config["model"];
  if (typeof model !== "string" || !model)
    throw new Error("@vivantel/virage-embedder-onnx: config.model is required");
  const dimensions = config["dimensions"];
  if (typeof dimensions !== "number" || dimensions <= 0)
    throw new Error(
      "@vivantel/virage-embedder-onnx: config.dimensions is required",
    );

  return new OnnxEmbedder({
    model,
    dimensions,
    tokenizerPath:
      typeof config["tokenizerPath"] === "string"
        ? config["tokenizerPath"]
        : undefined,
    maxSequenceLength:
      typeof config["maxSequenceLength"] === "number"
        ? config["maxSequenceLength"]
        : undefined,
    pooling: (config["pooling"] as "mean" | "cls") ?? undefined,
    normalize:
      typeof config["normalize"] === "boolean"
        ? config["normalize"]
        : undefined,
    cacheDir:
      typeof config["cacheDir"] === "string" ? config["cacheDir"] : undefined,
  });
}
