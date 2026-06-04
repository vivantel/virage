import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { EmbeddingsDb } from "@vivantel/virage-core";

export interface DashboardOptions {
  port: number;
  chunksFile: string;
  dbPath: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Resolve the compiled dashboard-ui/ directory shipped alongside this package.
// At runtime the compiled CLI lives at dist/cli/dashboard.js; dashboard-ui is at dist/dashboard-ui/.
const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const UI_DIR = join(THIS_DIR, "..", "dashboard-ui");
const HAS_UI = existsSync(join(UI_DIR, "index.html"));

async function serveStatic(urlPath: string, res: ServerResponse): Promise<boolean> {
  if (!HAS_UI) return false;

  const normalized = urlPath === "/" || urlPath === "" ? "/index.html" : urlPath;
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

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      res.setHeader("Content-Type", "application/json");

      try {
        if (url === "/api/status") {
          const status = await getStatus(opts.chunksFile, opts.dbPath);
          res.end(JSON.stringify(status));
          return;
        }

        if (url === "/api/chunks") {
          const chunks = await getChunksHistogram(opts.chunksFile);
          res.end(JSON.stringify(chunks));
          return;
        }

        if (url === "/api/embeddings/anomalies") {
          const anomalies = await getAnomalies(opts.dbPath);
          res.end(JSON.stringify(anomalies));
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
