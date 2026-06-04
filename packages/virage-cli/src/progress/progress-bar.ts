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
