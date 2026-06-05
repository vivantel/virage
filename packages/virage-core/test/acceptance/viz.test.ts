import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCLI } from './helpers/setup.js';
import { writeEmbeddingsDb } from './helpers/fixtures.js';

let dir: string;

describe('virage viz embeddings', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-viz-'));
    writeEmbeddingsDb(dir, 15);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('exits 0 and writes an HTML file', () => {
    const outputFile = join(dir, 'viz.html');
    const result = runCLI(
      dir,
      'viz', 'embeddings',
      '--embeddings', join(dir, 'rag-test', 'embeddings.db'),
      '--output', outputFile,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain('Visualization saved');
    expect(existsSync(outputFile)).toBe(true);
  });
});
