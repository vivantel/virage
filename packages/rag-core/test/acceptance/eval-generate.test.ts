import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCLI } from './helpers/setup.js';
import { writeChunks } from './helpers/fixtures.js';

let dir: string;

describe('rag-update eval-generate', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-evalgen-'));
    writeChunks(dir, 10);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('exits 0 and writes eval/queries.json', () => {
    const outputFile = join(dir, 'eval', 'queries.json');
    const result = runCLI(
      dir,
      'eval-generate',
      '--chunks', join(dir, 'rag-test', 'chunks.json'),
      '--output', outputFile,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain('Eval dataset saved');
    expect(existsSync(outputFile)).toBe(true);
  });
});
