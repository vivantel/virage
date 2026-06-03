import { readFile, writeFile, mkdir, readdir, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { ExperimentRun } from "../interfaces/quality.js";

const DEFAULT_DIR = ".rag-experiments";
const GITIGNORE_ENTRY = ".rag-experiments/\n";

export class ExperimentStore {
  constructor(private readonly dir: string = DEFAULT_DIR) {}

  async save(run: ExperimentRun): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    await this.ensureGitignore();

    const filename = `${run.id}.json`;
    const filepath = join(this.dir, filename);
    await writeFile(filepath, JSON.stringify(run, null, 2), "utf-8");
    return filepath;
  }

  async load(nameOrId: string): Promise<ExperimentRun> {
    const all = await this.list();

    // Exact ID match first
    const byId = all.find((r) => r.id === nameOrId);
    if (byId) return byId;

    // Name match: return most recent
    const byName = all
      .filter((r) => r.name === nameOrId)
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

    if (byName.length > 0) return byName[0];

    throw new Error(
      `Experiment "${nameOrId}" not found in "${this.dir}". ` +
        `Run "virage experiment run --name ${nameOrId}" first.`,
    );
  }

  async list(): Promise<ExperimentRun[]> {
    if (!existsSync(this.dir)) return [];

    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    const runs: ExperimentRun[] = [];

    for (const file of files) {
      try {
        const raw = await readFile(join(this.dir, file), "utf-8");
        runs.push(JSON.parse(raw) as ExperimentRun);
      } catch {
        // Skip malformed files silently
      }
    }

    return runs.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  private async ensureGitignore(): Promise<void> {
    const gitignorePath = ".gitignore";
    try {
      const content = existsSync(gitignorePath)
        ? await readFile(gitignorePath, "utf-8")
        : "";
      if (!content.includes(".rag-experiments")) {
        await appendFile(gitignorePath, GITIGNORE_ENTRY);
      }
    } catch {
      // Non-fatal: ignore if .gitignore can't be written
    }
  }
}

export function makeRunId(name: string): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}_${iso}`;
}
