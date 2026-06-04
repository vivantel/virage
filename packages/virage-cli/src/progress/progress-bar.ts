import cliProgress from "cli-progress";

export interface ProgressBar {
  update(current: number): void;
  setTotal(total: number): void;
  stop(finalMessage?: string): void;
}

export function createProgressBar(label: string, total: number): ProgressBar {
  const bar = new cliProgress.SingleBar(
    {
      format: `${label} [{bar}] {percentage}% | {value}/{total} | {duration_formatted} elapsed | ETA: {eta_formatted}`,
      clearOnComplete: false,
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );
  // Start with total=1 minimum so the bar renders; setTotal() updates it as work is discovered.
  bar.start(Math.max(total, 1), 0);

  return {
    update(current: number) {
      bar.update(current);
    },
    setTotal(newTotal: number) {
      bar.setTotal(Math.max(newTotal, 1));
    },
    stop(finalMessage?: string) {
      bar.stop();
      if (finalMessage) console.log(finalMessage);
    },
  };
}

export interface MultiProgressBars {
  chunk: ProgressBar;
  embed: ProgressBar;
  upload: ProgressBar;
  stop(): void;
  log(message: string): void;
}

const BAR_FORMAT =
  "{label} [{bar}] {percentage}% | {value}/{total} | {duration_formatted} elapsed | ETA: {eta_formatted}";

export function createMultiProgressBars(): MultiProgressBars {
  const multi = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      forceRedraw: true,
      autopadding: true,
      format: BAR_FORMAT,
    },
    cliProgress.Presets.shades_classic,
  );

  // Lazily adds a bar to the MultiBar on first setTotal() call so stages that
  // never fire (e.g. upload with --no-upload) don't appear in the output.
  const makeBar = (label: string): ProgressBar => {
    let inner: cliProgress.SingleBar | null = null;
    return {
      update(current: number) {
        inner?.update(current);
      },
      setTotal(newTotal: number) {
        if (!inner) {
          inner = multi.create(Math.max(newTotal, 1), 0, { label });
        } else {
          inner.setTotal(Math.max(newTotal, 1));
        }
      },
      stop() {},
    };
  };

  return {
    chunk: makeBar("Chunking "),
    embed: makeBar("Embedding"),
    upload: makeBar("Uploading"),
    stop() {
      multi.stop();
    },
    log(message: string) {
      multi.log(message);
    },
  };
}
