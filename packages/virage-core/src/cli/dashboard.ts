import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { EmbeddingsDb } from "../core/embeddings-db.js";

export interface DashboardOptions {
  port: number;
  chunksFile: string;
  dbPath: string;
}

const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>RAG Dashboard</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #7ec8e3; }
    .card { background: #16213e; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .metric { display: inline-block; margin: 8px 16px; }
    .metric .value { font-size: 2em; color: #7ec8e3; }
    .metric .label { font-size: 0.8em; color: #888; }
    .bar { height: 16px; background: #0f3460; border-radius: 4px; margin: 4px 0; position: relative; }
    .bar-fill { height: 100%; background: #7ec8e3; border-radius: 4px; }
    .anomaly { color: #ff6b6b; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 6px 12px; text-align: left; border-bottom: 1px solid #333; }
  </style>
</head>
<body>
  <h1>🤖 RAG Dashboard</h1>
  <div id="content">Loading...</div>
  <script>
    async function refresh() {
      const [status, chunks, anomalies] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/chunks').then(r => r.json()),
        fetch('/api/embeddings/anomalies').then(r => r.json()),
      ]);

      let html = '';

      // Status card
      html += '<div class="card"><h2>System Status</h2>';
      html += '<div class="metric"><div class="value">' + (status.totalChunks || 0) + '</div><div class="label">Total Chunks</div></div>';
      html += '<div class="metric"><div class="value">' + (status.totalEmbeddings || 0) + '</div><div class="label">Embeddings</div></div>';
      html += '<div class="metric"><div class="value">' + (status.memoryMB || 0) + ' MB</div><div class="label">Heap Used</div></div>';
      html += '</div>';

      // Chunk histogram
      if (chunks.histogram && chunks.histogram.length > 0) {
        html += '<div class="card"><h2>Chunk Size Distribution</h2>';
        const maxCount = Math.max(...chunks.histogram.map(b => b.count));
        for (const bucket of chunks.histogram) {
          const pct = maxCount > 0 ? Math.round((bucket.count / maxCount) * 100) : 0;
          html += '<div style="font-size:12px">' + bucket.label + '</div>';
          html += '<div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>';
          html += '<div style="font-size:11px;color:#888">' + bucket.count + ' chunks</div>';
        }
        html += '</div>';
      }

      // Anomalies
      if (anomalies.anomalies && anomalies.anomalies.length > 0) {
        html += '<div class="card"><h2>⚠️ Embedding Anomalies (' + anomalies.anomalies.length + ')</h2>';
        html += '<table><tr><th>File</th><th>z-score</th><th>Preview</th></tr>';
        for (const a of anomalies.anomalies.slice(0, 10)) {
          html += '<tr class="anomaly"><td>' + a.sourceFile + '</td><td>' + a.zscore.toFixed(2) + '</td><td>' + a.preview + '</td></tr>';
        }
        html += '</table></div>';
      } else {
        html += '<div class="card">✅ No embedding anomalies detected</div>';
      }

      document.getElementById('content').innerHTML = html;
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;

export async function runDashboard(opts: DashboardOptions): Promise<void> {
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      res.setHeader("Content-Type", "application/json");

      try {
        if (url === "/" || url === "/index.html") {
          res.setHeader("Content-Type", "text/html");
          res.end(HTML_TEMPLATE);
          return;
        }

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

        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found" }));
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
