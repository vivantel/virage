export { ansi } from "../ansi.js";
import { ansi, SPINNER_FRAMES } from "../ansi.js";
const BAR_WIDTH = 36; // model-loading phase bar width
const PIPELINE_BAR_WIDTH = 28; // pipeline table bar (fits 80-col terminals)
const RENDER_INTERVAL_MS = 80;
const LABEL_WIDTH = 13; // "Chunks sliced" is the longest label
const DONE_WIDTH = 14; // "490/490 files" = 13 chars

export interface ProgressBar {
  update(current: number): void;
  setTotal(total: number): void;
  stop(finalMessage?: string): void;
}

export interface MultiProgressBars {
  chunk: ProgressBar;
  embed: ProgressBar;
  upload: ProgressBar;
  stop(): void;
  log(message: string): void;
}

interface BarState {
  value: number;
  total: number;
}

function fmtTime(seconds: number): string {
  if (seconds === 0) return "0s";
  if (!isFinite(seconds) || isNaN(seconds) || seconds <= 0) return "?";
  if (seconds > 3600)
    return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds > 60)
    return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`;
  return `${Math.round(seconds)}s`;
}

function calcEtaMs(
  value: number,
  total: number,
  elapsedMs: number,
): number | null {
  if (value <= 0 || total <= 0 || elapsedMs <= 0) return null;
  if (value >= total) return 0;
  return ((total - value) / value) * elapsedMs;
}

function centerInWidth(text: string, width: number, fill = " "): string {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  return fill.repeat(left) + text + fill.repeat(pad - left);
}

function renderBar(value: number, total: number, width = BAR_WIDTH): string {
  const fillCount =
    total === 0 ? width : Math.min(width, Math.floor((value / total) * width));
  const fill = ansi.cyan + "█".repeat(fillCount) + ansi.reset;
  const empty = ansi.gray + "░".repeat(width - fillCount) + ansi.reset;
  return fill + empty;
}

function fmtSpeed(bytes: number, ms: number): string {
  if (ms <= 0) return "—";
  const bytesPerSec = (bytes / ms) * 1000;
  if (bytesPerSec >= 1_000_000)
    return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  return `${(bytesPerSec / 1_000).toFixed(0)} KB/s`;
}

function renderPct(value: number, total: number): string {
  const pct =
    total === 0 ? 100 : Math.min(100, Math.floor((value / total) * 100));
  const color = pct >= 100 ? ansi.green : ansi.yellow;
  return color + String(pct).padStart(3) + "%" + ansi.reset;
}

export class PipelineRenderer {
  private phase: "idle" | "scanning" | "model" | "pipeline" = "idle";
  private logBuffer: string[] = [];
  private ephemeralLines = 0;
  private lastPhaseStr = "";
  private readonly startTime = Date.now();
  private tickCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private _restoreCursor: (() => void) | undefined;

  // Scanning
  private scanDone = 0;
  private scanTotal = 0;

  // Model loading
  private modelName = "";
  private modelLoaded = 0;
  private modelTotal = 0;

  // Pipeline
  private bars: Record<"chunk" | "embed" | "upload", BarState> = {
    chunk: { value: 0, total: 0 },
    embed: { value: 0, total: 0 },
    upload: { value: 0, total: 0 },
  };

  private filesDone = 0;
  private filesTotal = 0;
  private embedSkipped = 0;

  private chunkingStats: { files: number; bytes: number; ms: number } | null =
    null;
  private embeddingStats: { chunks: number; bytes: number; ms: number } | null =
    null;

  private chunkPhaseT0 = 0; // epoch when first chunk progress seen (for live rate)
  private embedPhaseT0 = 0; // epoch when first embed progress seen (for live rate)

  constructor() {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?25l"); // hide cursor
      const restore = () => {
        if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
      };
      this._restoreCursor = restore;
      process.once("exit", restore);
      process.once("SIGINT", () => {
        restore();
        process.exit(130);
      });
      process.once("SIGTERM", () => {
        restore();
        process.exit(143);
      });
    }
    this.timer = setInterval(() => {
      this.tickCount++;
      const needsAnim = this.phase === "scanning" || this.phase === "model";
      // Update elapsed/ETA footer every ~960ms even with no new progress events
      const needsFooter =
        this.phase === "pipeline" && this.tickCount % 12 === 0;
      if (this.dirty || needsAnim || needsFooter) {
        this.dirty = false;
        this.doRender();
      }
    }, RENDER_INTERVAL_MS);
    // Don't keep the process alive just for the animation timer
    this.timer.unref();
  }

  log(message: string): void {
    this.logBuffer.push(message);
    this.dirty = true;
  }

  // --- Phase transitions ---

  startScanning(total: number): void {
    this.scanTotal = total;
    if (this.phase === "idle") this.phase = "scanning";
    this.dirty = true;
  }

  updateScanning(done: number, total: number): void {
    this.scanDone = done;
    this.scanTotal = total;
    this.dirty = true;
  }

  startModelLoading(model: string): void {
    if (this.phase === "scanning" && this.ephemeralLines > 0) {
      process.stdout.write("\n");
      this.ephemeralLines = 0;
    }
    this.modelName = model;
    this.phase = "model";
    this.dirty = true;
  }

  updateModelProgress(loaded: number, total: number): void {
    this.modelLoaded = loaded;
    this.modelTotal = total;
    this.dirty = true;
  }

  startPipeline(): void {
    if (this.phase === "model" && this.modelTotal > 0) {
      this.modelLoaded = this.modelTotal;
      this.doRender();
    }
    if (this.phase === "scanning" || this.phase === "model") {
      if (this.ephemeralLines > 0) process.stdout.write("\n");
    }
    this.phase = "pipeline";
    this.ephemeralLines = 0;
    this.dirty = true;
  }

  updateChunk(value: number, total: number): void {
    if (this.chunkPhaseT0 === 0 && value > 0) this.chunkPhaseT0 = Date.now();
    this.bars.chunk = { value: Math.max(this.bars.chunk.value, value), total };
    this.dirty = true;
  }

  updateEmbed(value: number, total: number): void {
    if (this.embedPhaseT0 === 0 && value > 0) this.embedPhaseT0 = Date.now();
    this.bars.embed = { value: Math.max(this.bars.embed.value, value), total };
    this.dirty = true;
  }

  updateUpload(value: number, total: number): void {
    this.bars.upload = {
      value: Math.max(this.bars.upload.value, value),
      total,
    };
    this.dirty = true;
  }

  updateFileIndexed(done: number, total: number): void {
    this.filesDone = done;
    this.filesTotal = total;
    this.dirty = true;
  }

  updateSkipped(skipped: number): void {
    this.embedSkipped = skipped;
    this.dirty = true;
  }

  setChunkingStats(files: number, bytes: number, ms: number): void {
    this.chunkingStats = { files, bytes, ms };
    this.dirty = true;
  }

  setEmbeddingStats(chunks: number, bytes: number, ms: number): void {
    this.embeddingStats = { chunks, bytes, ms };
    this.dirty = true;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const isSingleLine = this.phase === "scanning" || this.phase === "model";
    if (isSingleLine) {
      if (this.ephemeralLines > 0) process.stdout.write("\n");
    } else if (process.stdout.isTTY) {
      // Erase the entire ephemeral block cleanly before the final render so
      // stale content from a previous partial render never shows through.
      if (this.ephemeralLines > 0) {
        process.stdout.write(`\x1b[${this.ephemeralLines}A\x1b[J`);
        this.ephemeralLines = 0;
      }
      this.lastPhaseStr = "";
      this.doRender();
    } else {
      // Non-TTY: flush any buffered log messages then print the final table once.
      for (const msg of this.logBuffer) process.stdout.write(msg);
      this.logBuffer = [];
      for (const line of this.buildPhase()) {
        process.stdout.write(line + "\n");
      }
    }
    this._restoreCursor?.();
    this._restoreCursor = undefined;
  }

  // --- Rendering ---

  private doRender(): void {
    if (!process.stdout.isTTY) {
      for (const msg of this.logBuffer) process.stdout.write(msg);
      this.logBuffer = [];
      return;
    }

    const hasLogs = this.logBuffer.length > 0;
    const isSingleLine = this.phase === "scanning" || this.phase === "model";

    if (isSingleLine) {
      const phaseLines = this.buildPhase();
      const newPhaseStr = phaseLines.length > 0 ? phaseLines[0] : "";
      if (!hasLogs && newPhaseStr === this.lastPhaseStr) return;
      this.lastPhaseStr = newPhaseStr;

      if (hasLogs) {
        // Clear current single-line, write permanent logs, then redraw phase
        let out = "\r\x1b[K";
        for (const msg of this.logBuffer) {
          const line = msg.endsWith("\n") ? msg.slice(0, -1) : msg;
          out += line + "\n";
        }
        this.logBuffer = [];
        if (newPhaseStr) out += newPhaseStr + "\x1b[K";
        process.stdout.write(out);
      } else {
        // \r puts cursor at col 0; overwrite in-place — zero cursor-up movement
        process.stdout.write("\r" + newPhaseStr + "\x1b[K");
      }
      this.ephemeralLines = newPhaseStr ? 1 : 0;
    } else {
      // Pipeline (multi-line): cursor-up approach
      const phaseLines = this.buildPhase();
      const newPhaseStr = phaseLines.join("\n");
      if (!hasLogs && newPhaseStr === this.lastPhaseStr) return;
      this.lastPhaseStr = newPhaseStr;

      let out = "";
      if (this.ephemeralLines > 0) {
        // Erase the entire old block before re-rendering so any line-count
        // change (e.g. throughput row appearing) never leaves ghost content.
        out += `\x1b[${this.ephemeralLines}A\x1b[J`;
        this.ephemeralLines = 0;
      }
      for (const msg of this.logBuffer) {
        const line = msg.endsWith("\n") ? msg.slice(0, -1) : msg;
        out += line + "\n";
      }
      this.logBuffer = [];
      for (const line of phaseLines) {
        out += line + "\n";
      }
      process.stdout.write(out);
      this.ephemeralLines = phaseLines.length;
    }
  }

  private buildPhase(): string[] {
    switch (this.phase) {
      case "scanning":
        return this.buildScanning();
      case "model":
        return this.buildModel();
      case "pipeline":
        return this.buildPipeline();
      default:
        return [];
    }
  }

  private spinner(): string {
    return SPINNER_FRAMES[this.tickCount % SPINNER_FRAMES.length];
  }

  private buildScanning(): string[] {
    const sp = this.spinner();
    const fillCount =
      this.scanTotal > 0
        ? Math.floor((this.scanDone / this.scanTotal) * 20)
        : 0;
    const bar =
      ansi.cyan +
      "█".repeat(fillCount) +
      ansi.gray +
      "░".repeat(20 - fillCount) +
      ansi.reset;
    const pct =
      this.scanTotal > 0
        ? Math.floor((this.scanDone / this.scanTotal) * 100)
        : 0;
    const counter =
      this.scanTotal > 0
        ? `${this.scanDone}/${this.scanTotal} files`
        : "discovering files...";
    return [
      `${ansi.cyan}${sp}${ansi.reset} ${ansi.bold}Scanning${ansi.reset}  [${bar}] ${String(pct).padStart(3)}%  ${ansi.dim}${counter}${ansi.reset}`,
    ];
  }

  private buildModel(): string[] {
    const sp = this.spinner();
    const name = ansi.bold + this.modelName + ansi.reset;
    if (this.modelTotal > 0) {
      const pct = Math.min(
        100,
        Math.floor((this.modelLoaded / this.modelTotal) * 100),
      );
      const fillCount = Math.floor(
        (this.modelLoaded / this.modelTotal) * BAR_WIDTH,
      );
      const bar =
        "[" +
        ansi.yellow +
        "█".repeat(fillCount) +
        ansi.gray +
        "░".repeat(BAR_WIDTH - fillCount) +
        ansi.reset +
        "]";
      const pctStr = ansi.yellow + String(pct).padStart(3) + "%" + ansi.reset;
      return [
        `${ansi.yellow}${sp}${ansi.reset} ${ansi.bold}Loading model${ansi.reset} ${name}  ${bar} ${pctStr}`,
      ];
    }
    return [
      `${ansi.yellow}${sp}${ansi.reset} ${ansi.bold}Loading model${ansi.reset} ${name}`,
    ];
  }

  private liveChunkRate(): string {
    if (this.chunkingStats !== null) {
      const { files, ms } = this.chunkingStats;
      const secs = ms / 1000;
      return secs > 0 ? `${(files / secs).toFixed(1)} files/s` : "—";
    }
    if (this.chunkPhaseT0 === 0 || this.bars.chunk.value === 0) return "—";
    const secs = (Date.now() - this.chunkPhaseT0) / 1000;
    return secs > 1
      ? `${(this.bars.chunk.value / secs).toFixed(1)} files/s`
      : "…";
  }

  private liveEmbedRate(): string {
    if (this.embeddingStats !== null) {
      const { chunks, ms } = this.embeddingStats;
      const secs = ms / 1000;
      return secs > 0 ? `${Math.round(chunks / secs)} chunks/s` : "—";
    }
    if (this.embedPhaseT0 === 0 || this.bars.embed.value === 0) return "—";
    const secs = (Date.now() - this.embedPhaseT0) / 1000;
    return secs > 1
      ? `${Math.round(this.bars.embed.value / secs)} chunks/s`
      : "…";
  }

  private buildPipeline(): string[] {
    const elapsed = Date.now() - this.startTime;
    const sep = ` ${ansi.dim}│${ansi.reset} `;
    const dim = ansi.dim;
    const rst = ansi.reset;

    // Header: 4 columns — Operation | Progress | Done | Rate
    const barHeader =
      "[" +
      ansi.dim +
      centerInWidth(" Progress ", PIPELINE_BAR_WIDTH, "─") +
      ansi.reset +
      "]     "; // 5 spaces aligns with " NNN%"
    const header =
      ansi.bold +
      "Operation".padEnd(LABEL_WIDTH) +
      ansi.reset +
      sep +
      barHeader +
      sep +
      dim +
      "Done".padEnd(DONE_WIDTH) +
      rst +
      sep +
      dim +
      "Rate" +
      rst;

    // Count strings per phase
    const chunkDone = this.bars.chunk.value;
    const chunkTotal = this.bars.chunk.total;
    const chunkCount =
      chunkTotal > 0
        ? chunkDone >= chunkTotal
          ? `${chunkDone} files`
          : `${chunkDone}/${chunkTotal} files`
        : chunkDone > 0
          ? `${chunkDone} files`
          : "—";

    const embedDone = this.bars.embed.value;
    const embedTotal = this.bars.embed.total;
    const embedCount =
      embedTotal > 0
        ? embedDone >= embedTotal
          ? `${embedDone} chunks`
          : `${embedDone}/${embedTotal}`
        : embedDone > 0
          ? `${embedDone} chunks`
          : "—";

    const uploadDone = this.bars.upload.value;
    const uploadTotal = this.bars.upload.total;
    const uploadCount =
      uploadTotal > 0
        ? uploadDone >= uploadTotal
          ? `${uploadDone} docs`
          : `${uploadDone}/${uploadTotal}`
        : uploadDone > 0
          ? `${uploadDone} docs`
          : "—";

    const rows = [
      this.buildBarRow(
        "Chunking".padEnd(LABEL_WIDTH),
        this.bars.chunk,
        chunkCount,
        this.liveChunkRate(),
      ),
      this.buildBarRow(
        "Embedding".padEnd(LABEL_WIDTH),
        this.bars.embed,
        embedCount,
        this.liveEmbedRate(),
      ),
      this.buildBarRow(
        "Uploading".padEnd(LABEL_WIDTH),
        this.bars.upload,
        uploadCount,
        "—",
      ),
    ];

    // Footer: elapsed + ETA (ETA hidden once pipeline is done)
    const etaMs = this.calcPipelineEta(elapsed);
    const etaPart =
      etaMs === null
        ? `  ${dim}│${rst}  ${dim}ETA:${rst} …`
        : etaMs > 0
          ? `  ${dim}│${rst}  ${dim}ETA:${rst} ${fmtTime(etaMs / 1000)}`
          : "";
    const elapsedRow = `${dim}Elapsed:${rst} ${fmtTime(elapsed / 1000)}${etaPart}`;

    const lines: string[] = [header, ...rows, elapsedRow];

    // Throughput summary — shown once final stats are available
    if (this.chunkingStats !== null || this.embeddingStats !== null) {
      const parts: string[] = [];
      if (this.chunkingStats !== null) {
        const { files, bytes, ms } = this.chunkingStats;
        const secs = ms / 1000;
        const filesPerSec =
          secs > 0 ? `${(files / secs).toFixed(1)} files/s` : "—";
        parts.push(
          `${dim}Chunking:${rst} ${filesPerSec}  ${fmtSpeed(bytes, ms)}`,
        );
      }
      if (this.embeddingStats !== null) {
        const { chunks, bytes, ms } = this.embeddingStats;
        const secs = ms / 1000;
        const chunksPerSec =
          secs > 0 ? `${Math.round(chunks / secs)} chunks/s` : "—";
        parts.push(
          `${dim}Embedding:${rst} ${chunksPerSec}  ${fmtSpeed(bytes, ms)}`,
        );
      }
      if (parts.length > 0) lines.push(parts.join(`  ${dim}│${rst}  `));
    }

    return lines;
  }

  private calcPipelineEta(elapsedMs: number): number | null {
    // Use the most-downstream bar that has started — gives the most accurate ETA
    if (this.bars.upload.value > 0)
      return calcEtaMs(
        this.bars.upload.value,
        this.bars.upload.total,
        elapsedMs,
      );
    if (this.bars.embed.value > 0)
      return calcEtaMs(this.bars.embed.value, this.bars.embed.total, elapsedMs);
    if (this.bars.chunk.value > 0)
      return calcEtaMs(this.bars.chunk.value, this.bars.chunk.total, elapsedMs);
    return null;
  }

  private buildBarRow(
    label: string,
    bar: BarState,
    count: string,
    rate: string,
  ): string {
    const { value, total } = bar;
    const sep = ` ${ansi.dim}│${ansi.reset} `;
    const barContent =
      "[" +
      renderBar(value, total, PIPELINE_BAR_WIDTH) +
      "] " +
      renderPct(value, total);
    return (
      ansi.bold +
      label +
      ansi.reset +
      sep +
      barContent +
      sep +
      count.padEnd(DONE_WIDTH) +
      sep +
      rate
    );
  }
}

// Kept for backward compatibility with any external callers
export function createProgressBar(label: string, total: number): ProgressBar {
  let _total = total;
  let _current = 0;
  const tick = setInterval(() => {
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${label} ${_current}/${_total}`);
    }
  }, 100);
  (tick as ReturnType<typeof setInterval>).unref();
  return {
    update(current: number) {
      _current = current;
    },
    setTotal(newTotal: number) {
      _total = newTotal;
    },
    stop(finalMessage?: string) {
      clearInterval(tick);
      if (process.stdout.isTTY) process.stdout.write("\n");
      if (finalMessage) console.log(finalMessage);
    },
  };
}

// Kept for backward compatibility — wraps PipelineRenderer in the old MultiProgressBars shape
export function createMultiProgressBars(): MultiProgressBars {
  const renderer = new PipelineRenderer();
  renderer.startPipeline();
  const state = {
    chunk: { value: 0, total: 0 },
    embed: { value: 0, total: 0 },
    upload: { value: 0, total: 0 },
  };
  return {
    chunk: {
      update: (v) => {
        state.chunk.value = v;
        renderer.updateChunk(v, state.chunk.total);
      },
      setTotal: (t) => {
        state.chunk.total = t;
        renderer.updateChunk(state.chunk.value, t);
      },
      stop: () => {},
    },
    embed: {
      update: (v) => {
        state.embed.value = v;
        renderer.updateEmbed(v, state.embed.total);
      },
      setTotal: (t) => {
        state.embed.total = t;
        renderer.updateEmbed(state.embed.value, t);
      },
      stop: () => {},
    },
    upload: {
      update: (v) => {
        state.upload.value = v;
        renderer.updateUpload(v, state.upload.total);
      },
      setTotal: (t) => {
        state.upload.total = t;
        renderer.updateUpload(state.upload.value, t);
      },
      stop: () => {},
    },
    stop: () => renderer.stop(),
    log: (msg) => renderer.log(msg),
  };
}
