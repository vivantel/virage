import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCLI } from './helpers/setup.js';
import { writeTelemetry } from './helpers/fixtures.js';

let dir: string;

describe('virage report', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-report-'));
    writeTelemetry(dir);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('exits 0 and displays observability report', () => {
    const result = runCLI(dir, 'report', '--dir', join(dir, 'rag-test'));
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain('Observability Report');
  });

  it('exits 0 gracefully when no telemetry files exist', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'rag-report-empty-'));
    try {
      const result = runCLI(emptyDir, 'report', '--dir', join(emptyDir, 'rag-test'));
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toContain('No telemetry');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
