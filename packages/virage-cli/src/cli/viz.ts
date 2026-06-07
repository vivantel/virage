import { writeFile } from "fs/promises";
import { extname } from "path";
import { VirageDb } from "@vivantel/virage-core";

export interface VizEmbeddingsOptions {
  dbPath: string;
  output: string;
  projection: "umap" | "tsne";
}

// ---------------------------------------------------------------------------
// Minimal PCA-based 2-D projection (no external deps)
// ---------------------------------------------------------------------------

function mean(vectors: number[][]): number[] {
  const d = vectors[0].length;
  const m = new Array(d).fill(0) as number[];
  for (const v of vectors) {
    for (let i = 0; i < d; i++) m[i] += v[i];
  }
  return m.map((x) => x / vectors.length);
}

function subtract(v: number[], m: number[]): number[] {
  return v.map((x, i) => x - m[i]);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n === 0 ? v : v.map((x) => x / n);
}

/** Power iteration to find the top-2 principal components. */
function pca2d(vectors: number[][], iterations = 100): Array<[number, number]> {
  const centered = vectors.map((v) => subtract(v, mean(vectors)));
  const d = centered[0].length;

  const powerIterate = (excludes: number[][]): number[] => {
    let w = Array.from({ length: d }, () => Math.random() - 0.5);
    for (let iter = 0; iter < iterations; iter++) {
      // Compute A^T * A * w (covariance-like)
      const Aw = new Array(d).fill(0) as number[];
      for (const c of centered) {
        const proj = dot(c, w);
        for (let i = 0; i < d; i++) Aw[i] += proj * c[i];
      }
      // Deflate by excluded components
      for (const ex of excludes) {
        const p = dot(Aw, ex);
        for (let i = 0; i < d; i++) Aw[i] -= p * ex[i];
      }
      w = normalize(Aw);
    }
    return w;
  };

  const pc1 = powerIterate([]);
  const pc2 = powerIterate([pc1]);

  return centered.map((c) => [dot(c, pc1), dot(c, pc2)]);
}

export async function runVizEmbeddings(
  opts: VizEmbeddingsOptions,
): Promise<void> {
  console.log(`📂 Reading embeddings from "${opts.dbPath}"...`);

  const db = new VirageDb(opts.dbPath);
  const chunks = db.getAll();
  db.close();

  if (chunks.length === 0) {
    console.error("❌ No embeddings found.");
    process.exit(1);
  }

  console.log(`   Found ${chunks.length} embeddings`);

  // Try umap-js if installed; fall back to PCA
  let points: Array<[number, number]>;

  if (opts.projection === "umap") {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — umap-js is an optional peer dependency
      const { UMAP } = (await import("umap-js")) as {
        UMAP: new (opts: unknown) => {
          fitAsync: (data: number[][]) => Promise<number[][]>;
        };
      };
      console.log("🗺️  Computing UMAP projection...");
      const umap = new UMAP({ nComponents: 2, nNeighbors: 15, minDist: 0.1 });
      const result = await umap.fitAsync(chunks.map((c) => c.embedding));
      points = result.map((p: number[]) => [p[0], p[1]] as [number, number]);
    } catch {
      console.log("   umap-js not installed — falling back to PCA projection");
      points = pca2d(chunks.map((c) => c.embedding));
    }
  } else {
    console.log("🗺️  Computing PCA projection...");
    points = pca2d(chunks.map((c) => c.embedding));
  }

  // Build plot data
  const plotData = chunks.map((c, i) => ({
    x: points[i][0],
    y: points[i][1],
    label: c.sourceFile,
    ext: extname(c.sourceFile) || "unknown",
    preview: c.content.slice(0, 100).replace(/"/g, "'"),
  }));

  const html = buildHtml(plotData, opts.dbPath, opts.projection);
  await writeFile(opts.output, html, "utf-8");
  console.log(`✅ Visualization saved to "${opts.output}"`);
}

interface PlotPoint {
  x: number;
  y: number;
  label: string;
  ext: string;
  preview: string;
}

function buildHtml(
  points: PlotPoint[],
  source: string,
  projection: string,
): string {
  const extensions = [...new Set(points.map((p) => p.ext))];
  const colors = [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc948",
    "#b07aa1",
    "#ff9da7",
    "#9c755f",
    "#bab0ac",
  ];
  const colorMap: Record<string, string> = {};
  extensions.forEach((ext, i) => {
    colorMap[ext] = colors[i % colors.length];
  });

  const traces = extensions.map((ext) => {
    const pts = points.filter((p) => p.ext === ext);
    return {
      x: pts.map((p) => p.x),
      y: pts.map((p) => p.y),
      text: pts.map((p) => `${p.label}<br>${p.preview}`),
      mode: "markers",
      type: "scatter",
      name: ext,
      marker: { color: colorMap[ext], size: 6, opacity: 0.7 },
    };
  });

  const dataJson = JSON.stringify(traces);
  const title = `Embedding Space — ${projection.toUpperCase()} (${points.length} chunks from ${source})`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>RAG Embedding Visualization</title>
  <script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>
  <style>
    body { margin: 0; font-family: sans-serif; background: #1a1a2e; color: #eee; }
    #chart { width: 100vw; height: 100vh; }
    h1 { text-align: center; font-size: 14px; padding: 8px; margin: 0; }
  </style>
</head>
<body>
  <div id="chart"></div>
  <script>
    const data = ${dataJson};
    const layout = {
      title: ${JSON.stringify(title)},
      paper_bgcolor: '#1a1a2e',
      plot_bgcolor: '#16213e',
      font: { color: '#eee' },
      legend: { bgcolor: 'rgba(0,0,0,0.5)' },
      xaxis: { title: 'Component 1', gridcolor: '#333' },
      yaxis: { title: 'Component 2', gridcolor: '#333' },
      hovermode: 'closest',
    };
    Plotly.newPlot('chart', data, layout, { responsive: true });
  </script>
</body>
</html>`;
}
