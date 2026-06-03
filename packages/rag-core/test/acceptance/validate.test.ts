import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCLI, STORE_PKG } from './helpers/setup.js';

let dir: string;

describe('rag-update validate', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-validate-'));

    // Create a couple of markdown files so the chunker glob matches something
    mkdirSync(join(dir, 'skills'));
    writeFileSync(join(dir, 'README.md'), '# Test\nSome content.\n');
    writeFileSync(join(dir, 'skills', 'guide.md'), '# Guide\nDetails here.\n');

    writeFileSync(
      join(dir, 'rag.config.json'),
      JSON.stringify(
        {
          chunkers: [{ patterns: ['**/*.md'], strategy: 'markdownHeaders' }],
          embedder: {
            package: '@vivantel/rag-embedder-fastembed',
            config: { model: 'fast-bge-small-en-v1.5', dimensions: 384 },
          },
          vectorStore: {
            package: STORE_PKG,
            config: { path: './rag-test/vector-store.json' },
          },
        },
        null,
        2,
      ),
    );
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('exits 0 and reports tracked file count', () => {
    const result = runCLI(dir, 'validate', '-c', 'rag.config.json');
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain('matching file');
  });
});
