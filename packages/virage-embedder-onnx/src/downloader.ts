import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const HF_BASE = "https://huggingface.co";

function isHfModelId(model: string): boolean {
  return !model.startsWith("/") && !existsSync(model);
}

function defaultCacheDir(): string {
  return (
    process.env["VIRAGE_MODELS_DIR"] ?? join(homedir(), ".virage", "models")
  );
}

function safeModelName(modelId: string): string {
  return modelId.replace(/[/\\]/g, "--");
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download ${url}: ${res.status} ${res.statusText}`,
    );
  }
  const buf = await res.arrayBuffer();
  await writeFile(dest, Buffer.from(buf));
}

export interface ResolvedModel {
  modelPath: string;
  tokenizerPath: string;
}

export async function resolveModel(
  model: string,
  tokenizerOverride: string | undefined,
  cacheDir: string | undefined,
  log: (msg: string) => void,
): Promise<ResolvedModel> {
  if (!isHfModelId(model)) {
    // Local directory or file path
    const modelPath = existsSync(join(model, "model.onnx"))
      ? join(model, "model.onnx")
      : model;
    const tokenizerPath = tokenizerOverride ?? join(model, "tokenizer.json");
    return { modelPath, tokenizerPath };
  }

  // HuggingFace model ID — download if not cached
  const cDir = cacheDir ?? defaultCacheDir();
  const modelDir = join(cDir, safeModelName(model));
  const modelPath = join(modelDir, "model.onnx");
  const tokenizerPath = tokenizerOverride ?? join(modelDir, "tokenizer.json");

  mkdirSync(modelDir, { recursive: true });

  if (!existsSync(modelPath)) {
    const url = `${HF_BASE}/${model}/resolve/main/model.onnx`;
    log(`Downloading ${url} → ${modelPath}`);
    await downloadFile(url, modelPath);
  }

  if (!existsSync(tokenizerPath)) {
    const url = `${HF_BASE}/${model}/resolve/main/tokenizer.json`;
    log(`Downloading ${url} → ${tokenizerPath}`);
    await downloadFile(url, tokenizerPath);
  }

  return { modelPath, tokenizerPath };
}
