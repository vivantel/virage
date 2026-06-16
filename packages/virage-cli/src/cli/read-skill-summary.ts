import { readFile } from "fs/promises";
import { join } from "path";
import { resolveSkillsPackagePath } from "./skills.js";

export async function runReadSkillSummary(skillName: string): Promise<void> {
  const base = resolveSkillsPackagePath();
  if (!base) {
    process.stderr.write("Error: @vivantel/virage-skills package not found\n");
    process.exit(1);
  }

  const summaryPath = join(base, "skills", skillName, "SKILL.summary.md");
  const fullPath = join(base, "skills", skillName, "SKILL.md");

  let content: string | null = null;
  try {
    content = await readFile(summaryPath, "utf-8");
  } catch {
    try {
      const full = await readFile(fullPath, "utf-8");
      content = full.split("\n").slice(0, 20).join("\n");
    } catch {
      process.stderr.write(`Error: skill '${skillName}' not found\n`);
      process.exit(1);
    }
  }

  process.stdout.write(content);
}
