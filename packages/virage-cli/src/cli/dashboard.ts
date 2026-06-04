import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, extname, basename, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { EmbeddingsDb } from "@vivantel/virage-core";

export interface DashboardOptions {
  port: number;
  chunksFile: string;
  dbPath: string;
}

export interface ProjectEntry {
  label: string;
  rootPath: string;
  chunksFile: string;
  embeddingsDb: string;
  lastUsed: number;
}

interface ProjectsState {
  projects: ProjectEntry[];
  activeIndex: number;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const RECENT_PROJECTS_PATH = join(homedir(), ".virage", "recent-projects.json");
const MAX_PROJECTS = 10;

let projectsState: ProjectsState = { projects: [], activeIndex: 0 };

// Resolve the compiled dashboard-ui/ directory shipped alongside this package.
// At runtime the compiled CLI lives at dist/cli/dashboard.js; dashboard-ui is at dist/dashboard-ui/.
const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const UI_DIR = join(THIS_DIR, "..", "dashboard-ui");
const HAS_UI = existsSync(join(UI_DIR, "index.html"));

function projectFromRoot(
  rootPath: string,
  overrides?: { chunksFile?: string; embeddingsDb?: string },
): ProjectEntry {
  const abs = resolve(rootPath);
  return {
    label: basename(abs),
    rootPath: abs,
    chunksFile: overrides?.chunksFile ?? join(abs, ".virage", "chunks.json"),
    embeddingsDb:
      overrides?.embeddingsDb ?? join(abs, ".virage", "embeddings.db"),
    lastUsed: Date.now(),
  };
}

async function loadRecentProjects(): Promise<ProjectsState> {
  try {
    const raw = JSON.parse(
      await readFile(RECENT_PROJECTS_PATH, "utf-8"),
    ) as ProjectsState;
    if (Array.isArray(raw.projects) && typeof raw.activeIndex === "number") {
      return raw;
    }
  } catch {
    /* first run — file does not exist yet */
  }
  return { projects: [], activeIndex: 0 };
}

async function saveRecentProjects(state: ProjectsState): Promise<void> {
  const activeProject = state.projects[state.activeIndex];
  const sorted = [...state.projects]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_PROJECTS);
  const activeIndex = Math.max(
    0,
    sorted.findIndex((p) => p.rootPath === activeProject?.rootPath),
  );
  const next: ProjectsState = { projects: sorted, activeIndex };
  await mkdir(join(homedir(), ".virage"), { recursive: true });
  await writeFile(RECENT_PROJECTS_PATH, JSON.stringify(next, null, 2), "utf-8");
  projectsState = next;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function serveStatic(
  urlPath: string,
  res: ServerResponse,
): Promise<boolean> {
  if (!HAS_UI) return false;

  const normalized =
    urlPath === "/" || urlPath === "" ? "/index.html" : urlPath;
  // Only serve known static assets; fall back to index.html for SPA routing
  const filePath = join(UI_DIR, normalized);
  const ext = extname(filePath).toLowerCase();

  try {
    const content = await readFile(filePath);
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.end(content);
    return true;
  } catch {
    // Try index.html for SPA client-side routing (non-asset paths)
    if (!normalized.startsWith("/assets/") && ext === ".html") {
      try {
        const html = await readFile(join(UI_DIR, "index.html"));
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export async function runDashboard(opts: DashboardOptions): Promise<void> {
  if (!HAS_UI) {
    console.warn(
      "⚠️  Dashboard UI not found. Run `npm run build -w @vivantel/virage-dashboard` first.",
    );
  }

  // Derive the startup project from CLI options and register it
  const startupRoot = resolve(opts.chunksFile, "..", "..");
  const startupProject = projectFromRoot(startupRoot, {
    chunksFile: resolve(opts.chunksFile),
    embeddingsDb: resolve(opts.dbPath),
  });

  const loaded = await loadRecentProjects();
  const existingIdx = loaded.projects.findIndex(
    (p) => p.rootPath === startupProject.rootPath,
  );
  if (existingIdx >= 0) {
    loaded.projects[existingIdx] = startupProject;
    loaded.activeIndex = existingIdx;
  } else {
    loaded.projects.unshift(startupProject);
    loaded.activeIndex = 0;
  }
  await saveRecentProjects(loaded);

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      res.setHeader("Content-Type", "application/json");

      try {
        const active = projectsState.projects[projectsState.activeIndex];

        if (url === "/api/status" && req.method === "GET") {
          const status = await getStatus(
            active.chunksFile,
            active.embeddingsDb,
          );
          res.end(JSON.stringify(status));
          return;
        }

        if (url === "/api/chunks" && req.method === "GET") {
          const chunks = await getChunksHistogram(active.chunksFile);
          res.end(JSON.stringify(chunks));
          return;
        }

        if (url === "/api/embeddings/anomalies" && req.method === "GET") {
          const anomalies = await getAnomalies(active.embeddingsDb);
          res.end(JSON.stringify(anomalies));
          return;
        }

        if (url === "/api/projects" && req.method === "GET") {
          res.end(JSON.stringify(projectsState));
          return;
        }

        if (url === "/api/projects/add" && req.method === "POST") {
          const body = JSON.parse(await readBody(req)) as {
            rootPath?: unknown;
          };
          if (typeof body.rootPath !== "string" || !body.rootPath.trim()) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "rootPath is required" }));
            return;
          }
          const entry = projectFromRoot(body.rootPath.trim());
          if (
            !existsSync(entry.chunksFile) &&
            !existsSync(entry.embeddingsDb)
          ) {
            res.statusCode = 422;
            res.end(
              JSON.stringify({
                error: `No .virage data found in ${entry.rootPath}`,
              }),
            );
            return;
          }
          const idx = projectsState.projects.findIndex(
            (p) => p.rootPath === entry.rootPath,
          );
          const next = {
            ...projectsState,
            projects: [...projectsState.projects],
          };
          if (idx >= 0) {
            next.projects[idx] = { ...entry, lastUsed: Date.now() };
            next.activeIndex = idx;
          } else {
            next.projects = [entry, ...next.projects];
            next.activeIndex = 0;
          }
          await saveRecentProjects(next);
          res.end(JSON.stringify(projectsState));
          return;
        }

        if (url === "/api/projects/switch" && req.method === "POST") {
          const body = JSON.parse(await readBody(req)) as { index?: unknown };
          const index = Number(body.index);
          if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= projectsState.projects.length
          ) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid index" }));
            return;
          }
          const next = {
            projects: [...projectsState.projects],
            activeIndex: index,
          };
          next.projects[index] = {
            ...next.projects[index],
            lastUsed: Date.now(),
          };
          await saveRecentProjects(next);
          res.end(JSON.stringify(projectsState));
          return;
        }

        // Serve React app static assets
        const served = await serveStatic(url, res);
        if (!served) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
        }
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    },
  );

  server.listen(opts.port, () => {
    console.log(`🚀 RAG Dashboard running at http://localhost:${opts.port}`);
    console.log("   Press Ctrl+C to stop");
  });

  // Keep process alive
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      server.close();
      resolve();
    });
  });
}

async function getStatus(chunksFile: string, dbPath: string) {
  let totalChunks = 0;
  let totalEmbeddings = 0;

  try {
    const chunks = JSON.parse(await readFile(chunksFile, "utf-8")) as unknown;
    totalChunks = Array.isArray(chunks)
      ? chunks.length
      : ((chunks as { chunks?: unknown[] }).chunks?.length ?? 0);
  } catch {
    /* file may not exist yet */
  }

  try {
    const db = new EmbeddingsDb(dbPath);
    totalEmbeddings = db.getAll().length;
    db.close();
  } catch {
    /* db may not exist yet */
  }

  const memoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  return { totalChunks, totalEmbeddings, memoryMB };
}

async function getChunksHistogram(chunksFile: string) {
  try {
    const raw = JSON.parse(await readFile(chunksFile, "utf-8")) as unknown;
    const chunks = (
      Array.isArray(raw) ? raw : ((raw as { chunks?: unknown[] }).chunks ?? [])
    ) as Array<{ content: string }>;
    const sizes = chunks.map((c) => c.content?.length ?? 0);

    const buckets = [
      { label: "< 200 chars", min: 0, max: 200 },
      { label: "200–500 chars", min: 200, max: 500 },
      { label: "500–1k chars", min: 500, max: 1000 },
      { label: "1k–2k chars", min: 1000, max: 2000 },
      { label: "> 2k chars", min: 2000, max: Infinity },
    ];

    const histogram = buckets.map((b) => ({
      label: b.label,
      count: sizes.filter((s) => s >= b.min && s < b.max).length,
    }));

    return { histogram };
  } catch {
    return { histogram: [] };
  }
}

async function getAnomalies(dbPath: string) {
  try {
    const db = new EmbeddingsDb(dbPath);
    const chunks = db.getAll();
    db.close();

    if (chunks.length === 0) return { anomalies: [] };

    const norms = chunks.map((c) =>
      Math.sqrt(
        (c.embedding ?? []).reduce((s: number, v: number) => s + v * v, 0),
      ),
    );
    const mean = norms.reduce((s, v) => s + v, 0) / norms.length;
    const std = Math.sqrt(
      norms.reduce((s, v) => s + (v - mean) ** 2, 0) / norms.length,
    );

    const anomalies = chunks
      .map((c, i) => ({
        sourceFile: c.sourceFile ?? "unknown",
        zscore: std > 0 ? Math.abs(norms[i] - mean) / std : 0,
        preview: (c.content ?? "").slice(0, 60),
      }))
      .filter((a) => a.zscore > 2.5)
      .sort((a, b) => b.zscore - a.zscore);

    return { anomalies };
  } catch {
    return { anomalies: [] };
  }
}
