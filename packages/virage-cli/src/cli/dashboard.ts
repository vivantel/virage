import { createHash, randomUUID } from "crypto";
import express, { type Request, type Response } from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import {
  VirageDb,
  loadConfig,
  Orchestrator,
  ExperimentStore,
  makeRunId,
  bootstrapPairedTest,
  generateEvalDataset,
  EvalRunner,
  loadEvalDataset,
  type RAGPipelineConfig,
  type ExperimentRun,
} from "@vivantel/virage-core";

export interface DashboardOptions {
  port: number;
  dbPath: string;
}

export interface ProjectEntry {
  label: string;
  rootPath: string;
  virageDb: string;
  lastUsed: number;
}

interface ProjectsState {
  projects: ProjectEntry[];
  activeIndex: number;
}

const RECENT_PROJECTS_PATH = join(homedir(), ".virage", "recent-projects.json");
const MAX_PROJECTS = 10;

let projectsState: ProjectsState = { projects: [], activeIndex: 0 };

// Cache the loaded config per project root to avoid reloading the embedder model on every search
let configCache: { path: string; cfg: RAGPipelineConfig } | null = null;

// Single-operation guard for WebSocket pipeline runs
let wsOperationRunning = false;

const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const UI_DIR = join(THIS_DIR, "..", "dashboard-ui");
const HAS_UI = existsSync(join(UI_DIR, "index.html"));

function projectFromRoot(
  rootPath: string,
  overrides?: { virageDb?: string },
): ProjectEntry {
  const abs = resolve(rootPath);
  return {
    label: basename(abs),
    rootPath: abs,
    virageDb: overrides?.virageDb ?? join(abs, ".virage", "virage.db"),
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
    /* first run */
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
  configCache = null; // invalidate on project change
}

function activeProject() {
  return projectsState.projects[projectsState.activeIndex];
}

async function getCachedConfig(configPath: string): Promise<RAGPipelineConfig> {
  if (configCache?.path === configPath) return configCache.cfg;
  const cfg = await loadConfig(configPath);
  await cfg.vectorStore.initialize();

  const storedMeta = await cfg.vectorStore.readMeta?.();
  if (storedMeta) {
    const dimMismatch = storedMeta.dimensions !== cfg.embedder.dimensions;
    const modelMismatch =
      storedMeta.model &&
      cfg.embedder.model &&
      storedMeta.model !== cfg.embedder.model;
    if (dimMismatch || modelMismatch) {
      const indexDesc =
        storedMeta.providerName === "unknown"
          ? `${storedMeta.dimensions}d vectors`
          : `${storedMeta.providerName} (${storedMeta.dimensions}d, model "${storedMeta.model ?? "unknown"}")`;
      throw new Error(
        `Embedder mismatch: index was built with ${indexDesc}` +
          ` but current config uses ${cfg.embedder.name}` +
          ` (${cfg.embedder.dimensions}d, model "${cfg.embedder.model ?? "unknown"}").` +
          ` Run "virage index --force" to rebuild the index.`,
      );
    }
  }

  configCache = { path: configPath, cfg };
  return cfg;
}

// ─── Status helpers (preserved from original) ─────────────────────────────────

async function getStatus(dbPath: string) {
  let totalChunks = 0;
  let totalEmbeddings = 0;
  try {
    const db = new VirageDb(dbPath);
    totalChunks = db.getAllChunks().length;
    totalEmbeddings = db.getAll().length;
    db.close();
  } catch {
    /* db may not exist yet */
  }
  const memoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  return { totalChunks, totalEmbeddings, memoryMB };
}

async function getChunksHistogram(dbPath: string) {
  try {
    const db = new VirageDb(dbPath);
    const chunks = db.getAllChunks();
    db.close();
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
    const db = new VirageDb(dbPath);
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

// ─── WebSocket handler ─────────────────────────────────────────────────────────

function safeSend(ws: WebSocket, msg: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function handleWsOperation(ws: WebSocket, msg: Record<string, unknown>) {
  const op = String(msg.op ?? "");
  const active = activeProject();
  if (!active) {
    safeSend(ws, { type: "error", message: "No active project" });
    return;
  }

  const configPath = join(active.rootPath, "virage.config.json");
  if (!existsSync(configPath)) {
    safeSend(ws, {
      type: "error",
      message: `virage.config.json not found in ${active.rootPath}`,
    });
    return;
  }

  try {
    const cfg = await getCachedConfig(configPath);

    if (op === "update") {
      const orchestrator = new Orchestrator({
        ...cfg,
        options: {
          ...cfg.options,
          onChunkProgress: (done, total) =>
            safeSend(ws, { type: "progress", stage: "chunk", done, total }),
          onEmbedProgress: (done, total) =>
            safeSend(ws, { type: "progress", stage: "embed", done, total }),
          onUploadProgress: (done, total) =>
            safeSend(ws, { type: "progress", stage: "upload", done, total }),
        },
      });
      safeSend(ws, { type: "progress", stage: "starting", done: 0, total: 0 });
      await orchestrator.run();
      safeSend(ws, { type: "done" });
    } else if (op === "eval-generate") {
      const db = new VirageDb(active.virageDb);
      const chunks = db.getAllChunks();
      db.close();
      safeSend(ws, {
        type: "progress",
        stage: "eval-generate",
        message: `Generating eval dataset from ${chunks.length} chunks...`,
      });
      const outputPath = join(active.rootPath, ".virage", "eval-dataset.json");
      await generateEvalDataset(
        chunks,
        { includeNegatives: false, paraphraseRatio: 0 },
        outputPath,
      );
      safeSend(ws, {
        type: "done",
        message: `Eval dataset written to ${outputPath}`,
      });
    } else if (op === "evaluate") {
      const datasetPath = join(active.rootPath, ".virage", "eval-dataset.json");
      if (!existsSync(datasetPath)) {
        safeSend(ws, {
          type: "error",
          message: "No eval dataset found. Run eval-generate first.",
        });
        return;
      }
      const dataset = await loadEvalDataset(datasetPath);
      safeSend(ws, {
        type: "progress",
        stage: "evaluate",
        message: `Evaluating ${dataset.queries.length} queries...`,
      });
      const runner = new EvalRunner(cfg.vectorStore, cfg.embedder, dataset, 10);
      const result = await runner.run((completed, total) =>
        safeSend(ws, {
          type: "progress",
          stage: "evaluate",
          done: completed,
          total,
        }),
      );
      safeSend(ws, { type: "done", result });
    } else if (op === "experiment-run") {
      const name =
        typeof msg.name === "string" && msg.name.trim()
          ? msg.name.trim()
          : "experiment";
      const datasetPath = join(active.rootPath, ".virage", "eval-dataset.json");
      if (!existsSync(datasetPath)) {
        safeSend(ws, {
          type: "error",
          message:
            'No eval dataset found. Run "Generate eval dataset" from the Pipeline tab first.',
        });
        return;
      }
      const dataset = await loadEvalDataset(datasetPath);
      safeSend(ws, {
        type: "progress",
        stage: "experiment",
        message: `Running experiment "${name}" — ${dataset.queries.length} queries…`,
      });
      const runner = new EvalRunner(cfg.vectorStore, cfg.embedder, dataset, 10);
      const { evalResult, perQueryRrScores } = await runner.run(
        (completed, total) =>
          safeSend(ws, {
            type: "progress",
            stage: "experiment",
            done: completed,
            total,
          }),
      );
      const expDb = new VirageDb(active.virageDb);
      try {
        const store = new ExperimentStore(expDb);
        const run: ExperimentRun = {
          id: makeRunId(name),
          name,
          timestamp: new Date().toISOString(),
          config: { configFile: configPath, dataset: datasetPath },
          evalResult,
          perQueryRrScores,
        };
        await store.save(run);
        safeSend(ws, { type: "done", result: run });
      } finally {
        expDb.close();
      }
    } else {
      safeSend(ws, { type: "error", message: `Unknown operation: ${op}` });
    }
  } catch (err) {
    safeSend(ws, {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Main entry point ──────────────────────────────────────────────────────────

export async function runDashboard(opts: DashboardOptions): Promise<void> {
  if (!HAS_UI) {
    console.warn(
      "⚠️  Dashboard UI not found. Run `npm run build -w @vivantel/virage-dashboard` first.",
    );
  }

  const startupRoot = resolve(opts.dbPath, "..", "..");
  const startupProject = projectFromRoot(startupRoot, {
    virageDb: resolve(opts.dbPath),
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

  const app = express();
  app.use(express.json());

  // ─── Existing routes ────────────────────────────────────────────────────────

  app.get("/api/status", async (_req: Request, res: Response) => {
    const active = activeProject();
    res.json(await getStatus(active?.virageDb ?? opts.dbPath));
  });

  app.get("/api/chunks", async (_req: Request, res: Response) => {
    const active = activeProject();
    res.json(await getChunksHistogram(active?.virageDb ?? opts.dbPath));
  });

  app.get("/api/embeddings/anomalies", async (_req: Request, res: Response) => {
    const active = activeProject();
    res.json(await getAnomalies(active?.virageDb ?? opts.dbPath));
  });

  app.get("/api/projects", (_req: Request, res: Response) => {
    res.json(projectsState);
  });

  app.post("/api/projects/add", async (req: Request, res: Response) => {
    const body = req.body as { rootPath?: unknown };
    if (typeof body.rootPath !== "string" || !body.rootPath.trim()) {
      res.status(400).json({ error: "rootPath is required" });
      return;
    }
    const entry = projectFromRoot(body.rootPath.trim());
    if (!existsSync(entry.virageDb)) {
      res.status(422).json({
        error: `No .virage data found in ${entry.rootPath}`,
      });
      return;
    }
    const idx = projectsState.projects.findIndex(
      (p) => p.rootPath === entry.rootPath,
    );
    const next = { ...projectsState, projects: [...projectsState.projects] };
    if (idx >= 0) {
      next.projects[idx] = { ...entry, lastUsed: Date.now() };
      next.activeIndex = idx;
    } else {
      next.projects = [entry, ...next.projects];
      next.activeIndex = 0;
    }
    await saveRecentProjects(next);
    res.json(projectsState);
  });

  app.post("/api/projects/switch", async (req: Request, res: Response) => {
    const body = req.body as { index?: unknown };
    const index = Number(body.index);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= projectsState.projects.length
    ) {
      res.status(400).json({ error: "Invalid index" });
      return;
    }
    const next = {
      projects: [...projectsState.projects],
      activeIndex: index,
    };
    next.projects[index] = { ...next.projects[index], lastUsed: Date.now() };
    await saveRecentProjects(next);
    res.json(projectsState);
  });

  // ─── New chunk routes ────────────────────────────────────────────────────────

  app.get("/api/chunks/all", (req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    try {
      const db = new VirageDb(active.virageDb);
      let chunks = db.getAllChunks();
      db.close();
      const sf = req.query["sourceFile"];
      if (typeof sf === "string") {
        chunks = chunks.filter((c) => c.sourceFile === sf);
      }
      res.json({ chunks });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete("/api/chunks/file", (req: Request, res: Response) => {
    const body = req.body as { sourceFile?: unknown };
    if (typeof body.sourceFile !== "string" || !body.sourceFile.trim()) {
      res.status(400).json({ error: "sourceFile is required" });
      return;
    }
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    try {
      const db = new VirageDb(active.virageDb);
      db.deleteBySourceFile(body.sourceFile.trim());
      db.close();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete("/api/chunks/all", (_req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    try {
      const db = new VirageDb(active.virageDb);
      db.clearAll();
      db.close();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Meta-check route ────────────────────────────────────────────────────────

  app.get("/api/meta-check", async (_req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.json({ status: "unknown", message: "No active project" });
      return;
    }
    const configPath = join(active.rootPath, "virage.config.json");
    if (!existsSync(configPath)) {
      res.json({ status: "unknown", message: "virage.config.json not found" });
      return;
    }
    try {
      await getCachedConfig(configPath);
      res.json({ status: "ok" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Embedder mismatch")) {
        res.json({ status: "mismatch", message: msg });
      } else {
        res.json({ status: "unknown", message: msg });
      }
    }
  });

  // ─── RAG search route ────────────────────────────────────────────────────────

  app.post("/api/search", async (req: Request, res: Response) => {
    const body = req.body as { query?: unknown; topK?: unknown };
    if (typeof body.query !== "string" || !body.query.trim()) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const configPath = join(active.rootPath, "virage.config.json");
    if (!existsSync(configPath)) {
      res
        .status(422)
        .json({ error: `virage.config.json not found in ${active.rootPath}` });
      return;
    }
    try {
      const cfg = await getCachedConfig(configPath);
      const topK = typeof body.topK === "number" ? body.topK : 5;
      const queryText = body.query.trim();
      const useHybrid = cfg.search?.hybrid ?? false;
      const embedding = await cfg.embedder.embed(queryText);
      let results = await cfg.vectorStore.search(embedding, topK, undefined, {
        ...(useHybrid
          ? {
              hybrid: true,
              hybridAlpha: cfg.search?.hybridAlpha,
              queryText,
            }
          : {}),
      });
      const reranked = cfg.search?.reranker != null;
      if (cfg.search?.reranker) {
        results = await cfg.search.reranker.rerank(queryText, results, topK);
      }

      // Log to analytics table (best-effort)
      try {
        const db = new VirageDb(active.virageDb);
        db.insertSearchQuery({
          id: randomUUID(),
          occurred_at: new Date().toISOString(),
          query_text: queryText,
          query_hash: createHash("sha256")
            .update(queryText.toLowerCase())
            .digest("hex"),
          result_count: results.length,
          top_similarity: results[0]?.similarity ?? null,
          was_empty: results.length === 0 ? 1 : 0,
          hybrid_used: useHybrid ? 1 : 0,
          reranked: reranked ? 1 : 0,
        });
        db.close();
      } catch {
        // Analytics failure must not break search
      }

      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Experiment routes ───────────────────────────────────────────────────────

  const ID_RE = /^[a-zA-Z0-9_-]+$/;

  app.get("/api/experiments", async (_req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const db = new VirageDb(active.virageDb);
    try {
      const store = new ExperimentStore(db);
      const runs = await store.list();
      res.json({ runs });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  app.get("/api/experiments/:id", async (req: Request, res: Response) => {
    if (!ID_RE.test((req.params["id"] as string) ?? "")) {
      res.status(400).json({ error: "Invalid experiment id" });
      return;
    }
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const db = new VirageDb(active.virageDb);
    try {
      const store = new ExperimentStore(db);
      const run = await store.load(req.params["id"] as string);
      res.json(run);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  app.delete("/api/experiments/:id", async (req: Request, res: Response) => {
    if (!ID_RE.test((req.params["id"] as string) ?? "")) {
      res.status(400).json({ error: "Invalid experiment id" });
      return;
    }
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const db = new VirageDb(active.virageDb);
    try {
      const store = new ExperimentStore(db);
      await store.delete(req.params["id"] as string);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  app.post("/api/experiments/compare", async (req: Request, res: Response) => {
    const body = req.body as { baseline?: unknown; candidate?: unknown };
    if (
      typeof body.baseline !== "string" ||
      typeof body.candidate !== "string"
    ) {
      res
        .status(400)
        .json({ error: "baseline and candidate ids are required" });
      return;
    }
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const db = new VirageDb(active.virageDb);
    try {
      const store = new ExperimentStore(db);
      const [bRun, cRun] = await Promise.all([
        store.load(body.baseline),
        store.load(body.candidate),
      ]);
      if (!bRun.perQueryRrScores || !cRun.perQueryRrScores) {
        res
          .status(422)
          .json({ error: "Per-query scores unavailable for comparison" });
        return;
      }
      const result = bootstrapPairedTest(
        bRun.perQueryRrScores,
        cRun.perQueryRrScores,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  // ─── Query analytics routes ──────────────────────────────────────────────────

  app.get("/api/analytics/queries", (req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const limit = typeof req.query.limit === "string"
      ? Math.min(parseInt(req.query.limit, 10) || 50, 200)
      : 50;
    const db = new VirageDb(active.virageDb);
    try {
      const queries = db.getRecentSearchQueries(limit);
      res.json({ queries });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  app.get("/api/analytics/top-terms", (req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const limit = typeof req.query.limit === "string"
      ? Math.min(parseInt(req.query.limit, 10) || 20, 100)
      : 20;
    const db = new VirageDb(active.virageDb);
    try {
      const terms = db.getTopSearchTerms(limit);
      res.json({ terms });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  app.get("/api/analytics/zero-results", (req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const threshold = typeof req.query.threshold === "string"
      ? parseFloat(req.query.threshold) || 0.5
      : 0.5;
    const limit = typeof req.query.limit === "string"
      ? Math.min(parseInt(req.query.limit, 10) || 50, 200)
      : 50;
    const db = new VirageDb(active.virageDb);
    try {
      const queries = db.getZeroResultQueries(threshold, limit);
      res.json({ queries });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  app.get("/api/analytics/stats", (_req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const db = new VirageDb(active.virageDb);
    try {
      const stats = db.getSearchStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  app.get("/api/analytics/queries-per-hour", (req: Request, res: Response) => {
    const active = activeProject();
    if (!active) {
      res.status(503).json({ error: "No active project" });
      return;
    }
    const hours = typeof req.query.hours === "string"
      ? Math.min(parseInt(req.query.hours, 10) || 24, 168)
      : 24;
    const db = new VirageDb(active.virageDb);
    try {
      const buckets = db.getQueriesPerHour(hours);
      res.json({ buckets });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      db.close();
    }
  });

  // ─── Static assets + SPA fallback ───────────────────────────────────────────

  if (HAS_UI) {
    app.use(express.static(UI_DIR));
    app.get("/{*splat}", (_req: Request, res: Response) => {
      res.sendFile(join(UI_DIR, "index.html"));
    });
  }

  // ─── Start server + attach WebSocket ────────────────────────────────────────

  const server = app.listen(opts.port, () => {
    console.log(`🚀 RAG Dashboard running at http://localhost:${opts.port}`);
    console.log("   Press Ctrl+C to stop");
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        safeSend(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      if (wsOperationRunning) {
        safeSend(ws, { type: "busy" });
        return;
      }

      wsOperationRunning = true;
      handleWsOperation(ws, msg).finally(() => {
        wsOperationRunning = false;
      });
    });
  });

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      wss.close();
      server.close();
      resolve();
    });
  });
  process.exit(0);
}
