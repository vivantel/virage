import cliProgress from "cli-progress";

export interface ProgressBar {
  update(current: number): void;
  stop(finalMessage?: string): void;
}

export function createProgressBar(label: string, total: number): ProgressBar {
  if (total === 0) {
    return { update: () => {}, stop: () => {} };
  }

  const bar = new cliProgress.SingleBar(
    {
      format: `${label} [{bar}] {percentage}% | {value}/{total} | ETA: {eta_formatted}`,
      clearOnComplete: false,
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );
  bar.start(total, 0);

  return {
    update(current: number) {
      bar.update(current);
    },
    stop(finalMessage?: string) {
      bar.stop();
      if (finalMessage) console.log(finalMessage);
    },
  };
}
