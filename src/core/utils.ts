import { createHash } from "crypto";

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  retryBackoffFactor?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const delayMs = opts.retryDelayMs ?? 1000;
  const factor = opts.retryBackoffFactor ?? 2;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const wait = Math.round(delayMs * Math.pow(factor, attempt));
        console.warn(
          `  ⚠️ Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${wait}ms...`,
        );
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

export async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const results = new Array<T>(tasks.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workerCount = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

export function batchBySize<T>(
  items: T[],
  maxItems: number,
  getSize: (item: T) => number,
  maxSize: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;

  for (const item of items) {
    const size = getSize(item);
    if (current.length > 0 && (current.length >= maxItems || currentSize + size > maxSize)) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(item);
    currentSize += size;
  }

  if (current.length > 0) batches.push(current);
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
