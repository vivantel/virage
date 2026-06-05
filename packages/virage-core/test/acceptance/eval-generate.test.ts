import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCLI } from './helpers/setup.js';
import { writeEmbeddingsDb } from './helpers/fixtures.js';

let dir: string;

describe('virage eval-generate', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-evalgen-'));
    writeEmbeddingsDb(dir, 10);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('exits 0 and writes eval/queries.json', () => {
    const outputFile = join(dir, 'eval', 'queries.json');
    const result = runCLI(
      dir,
      'eval-generate',
      '--embeddings', join(dir, 'rag-test', 'embeddings.db'),
      '--output', outputFile,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain('Eval dataset saved');
    expect(existsSync(outputFile)).toBe(true);
  });
});
