import { createHash } from "crypto";

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

export function extractFileName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

export function extractDirectory(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/");
}
