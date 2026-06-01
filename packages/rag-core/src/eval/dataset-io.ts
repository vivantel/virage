import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { EvalDataset } from "../interfaces/quality.js";

export async function loadEvalDataset(path: string): Promise<EvalDataset> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read eval dataset at "${path}": ${(err as Error).message}. ` +
        `Create it with: rag-update eval-generate`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Eval dataset at "${path}" is not valid JSON`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Eval dataset at "${path}" must be an object with a "queries" array`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.queries)) {
    throw new Error(`Eval dataset at "${path}" must have a "queries" array`);
  }

  for (let i = 0; i < obj.queries.length; i++) {
    const q = obj.queries[i] as Record<string, unknown>;
    if (typeof q.query !== "string") {
      throw new Error(
        `Eval dataset at "${path}": queries[${i}].query must be a string`,
      );
    }
  }

  return parsed as EvalDataset;
}

export async function saveEvalDataset(
  path: string,
  dataset: EvalDataset,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(dataset, null, 2), "utf-8");
}
