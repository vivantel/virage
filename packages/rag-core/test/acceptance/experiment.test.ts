import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCLI } from './helpers/setup.js';
import { writeExperimentRun } from './helpers/fixtures.js';

let dir: string;
let baselineId: string;
let candidateId: string;

describe('rag-update experiment', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-experiment-'));
    baselineId = writeExperimentRun(dir, 'baseline', 0.60);
    candidateId = writeExperimentRun(dir, 'candidate', 0.75);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('list — exits 0 and shows run table', () => {
    const result = runCLI(dir, 'experiment', 'list');
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain('Experiment Runs');
    expect(out).toContain('baseline');
    expect(out).toContain('candidate');
  });

  it('compare — exits 0 and shows MRR delta', () => {
    const result = runCLI(
      dir,
      'experiment', 'compare',
      '--baseline', baselineId,
      '--candidate', candidateId,
    );
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain('MRR');
  });
});
