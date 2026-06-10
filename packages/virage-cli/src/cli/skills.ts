import { createRequire } from "module";
import { createHash } from "crypto";
import { readFile, writeFile, mkdir, rm, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, relative } from "path";

export interface SkillManifestEntry {
  contentHash: string;
  installedAt: string;
}

export interface SkillManifest {
  installedFrom: string;
  packageVersion: string;
  updatedAt: string;
  skills: Record<string, SkillManifestEntry>;
}

export interface SkillsSyncResult {
  created: string[];
  updated: string[];
  deleted: string[];
  skipped: string[];
}

const SKILLS_INSTALL_DIR = ".agents/skills/virage";
const MANIFEST_FILE = ".manifest.json";

export function resolveSkillsPackagePath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve("@vivantel/virage-skills/package.json");
    return dirname(pkgJsonPath);
  } catch {
    return null;
  }
}

function hashContent(content: string): string {
  return (
    "sha256:" + createHash("sha256").update(content, "utf-8").digest("hex")
  );
}

interface SkillFile {
  relPath: string;
  content: string;
  contentHash: string;
}

async function collectSkillFiles(
  dir: string,
  base: string = dir,
): Promise<SkillFile[]> {
  const results: SkillFile[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectSkillFiles(fullPath, base)));
    } else if (entry.isFile()) {
      const content = await readFile(fullPath, "utf-8");
      results.push({
        relPath: relative(base, fullPath),
        content,
        contentHash: hashContent(content),
      });
    }
  }
  return results;
}

export async function readManifest(
  targetDir: string,
): Promise<SkillManifest | null> {
  const manifestPath = join(targetDir, SKILLS_INSTALL_DIR, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = await readFile(manifestPath, "utf-8");
    return JSON.parse(raw) as SkillManifest;
  } catch {
    return null;
  }
}

async function writeManifest(
  manifest: SkillManifest,
  targetDir: string,
): Promise<void> {
  const manifestPath = join(targetDir, SKILLS_INSTALL_DIR, MANIFEST_FILE);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

export async function syncSkills(
  skillsPkgPath: string,
  targetDir: string,
): Promise<SkillsSyncResult> {
  const skillsSourceDir = join(skillsPkgPath, "skills");
  const skillsDestDir = join(targetDir, SKILLS_INSTALL_DIR);

  await mkdir(skillsDestDir, { recursive: true });

  const pkgJsonRaw = await readFile(
    join(skillsPkgPath, "package.json"),
    "utf-8",
  );
  const pkgJson = JSON.parse(pkgJsonRaw) as { version?: string };
  const packageVersion = pkgJson.version ?? "unknown";

  const sourceFiles = await collectSkillFiles(skillsSourceDir);
  const manifest = (await readManifest(targetDir)) ?? {
    installedFrom: "@vivantel/virage-skills",
    packageVersion,
    updatedAt: new Date().toISOString(),
    skills: {},
  };

  const result: SkillsSyncResult = {
    created: [],
    updated: [],
    deleted: [],
    skipped: [],
  };

  const now = new Date().toISOString();

  // Create / update
  for (const file of sourceFiles) {
    const destPath = join(skillsDestDir, file.relPath);
    const existing = manifest.skills[file.relPath];

    if (!existing) {
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, file.content);
      manifest.skills[file.relPath] = {
        contentHash: file.contentHash,
        installedAt: now,
      };
      result.created.push(file.relPath);
    } else if (existing.contentHash !== file.contentHash) {
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, file.content);
      manifest.skills[file.relPath] = {
        contentHash: file.contentHash,
        installedAt: existing.installedAt,
      };
      result.updated.push(file.relPath);
    } else {
      result.skipped.push(file.relPath);
    }
  }

  // Delete removed skills
  const sourceRelPaths = new Set(sourceFiles.map((f) => f.relPath));
  for (const relPath of Object.keys(manifest.skills)) {
    if (!sourceRelPaths.has(relPath)) {
      const destPath = join(skillsDestDir, relPath);
      if (existsSync(destPath)) {
        await rm(destPath, { force: true });
      }
      delete manifest.skills[relPath];
      result.deleted.push(relPath);
    }
  }

  manifest.packageVersion = packageVersion;
  manifest.updatedAt = now;

  await writeManifest(manifest, targetDir);

  return result;
}
