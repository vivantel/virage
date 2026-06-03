import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { CLI, setupEnv, teardownEnv, runCLI, type TestEnv } from './helpers/setup.js';

let env: TestEnv;

describe('rag-update store stats / store perf', () => {
  beforeAll(() => {
    if (!existsSync(CLI)) throw new Error(`CLI not found at ${CLI}. Run "npm run build" first.`);

    env = setupEnv();

    // Populate the store by running the pipeline first
    const result = runCLI(env.cloneDir, 'update', '--config', 'rag.config.json', '-v');
    if (result.status !== 0) {
      throw new Error(`Pipeline setup failed:\n${result.stderr}`);
    }
  });

  afterAll(() => teardownEnv(env));

  it('store stats — exits 0 and shows index stats', () => {
    const result = runCLI(env.cloneDir, 'store', 'stats', '-c', 'rag.config.json');
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain('Vector Index Stats');
    expect(out).toContain('Total vectors');
  });

  it('store perf — exits 0 and shows query performance report', () => {
    const result = runCLI(env.cloneDir, 'store', 'perf', '-c', 'rag.config.json');
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain('Query Performance Report');
  });
});
