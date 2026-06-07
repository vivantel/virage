import type { ExperimentRun } from "../interfaces/quality.js";
import type { VirageDb } from "../core/virage-db.js";

export class ExperimentStore {
  constructor(private readonly db: VirageDb) {}

  async save(run: ExperimentRun): Promise<string> {
    this.db.saveExperimentRun(run);
    return run.id;
  }

  async load(nameOrId: string): Promise<ExperimentRun> {
    const run = this.db.loadExperimentRun(nameOrId);
    if (!run) {
      throw new Error(
        `Experiment "${nameOrId}" not found. ` +
          `Run "virage experiment run --name ${nameOrId}" first.`,
      );
    }
    return run;
  }

  async list(): Promise<ExperimentRun[]> {
    return this.db.listExperimentRuns();
  }

  async delete(id: string): Promise<void> {
    this.db.deleteExperimentRun(id);
  }
}

export function makeRunId(name: string): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}_${iso}`;
}
