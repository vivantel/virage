import { ansi, SPINNER_FRAMES } from "./ansi.js";

const RENDER_MS = 80;

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function withSpinner<T>(
  label: string,
  fn: () => Promise<T>,
  thresholdMs = 2000,
): Promise<T> {
  const isTTY = process.stdout.isTTY;
  const start = Date.now();

  let spinnerActive = false;
  let frame = 0;
  let renderTimer: ReturnType<typeof setInterval> | null = null;

  const startSpinner = () => {
    spinnerActive = true;
    if (isTTY) {
      process.stdout.write("\x1b[?25l"); // hide cursor
      process.stdout.write(
        `${ansi.cyan}${SPINNER_FRAMES[0]}${ansi.reset} ${label}...\x1b[K`,
      );
      renderTimer = setInterval(() => {
        frame = (frame + 1) % SPINNER_FRAMES.length;
        process.stdout.write(
          `\r${ansi.cyan}${SPINNER_FRAMES[frame]}${ansi.reset} ${label}...\x1b[K`,
        );
      }, RENDER_MS);
      renderTimer.unref();
    } else {
      process.stdout.write(`${label}...\n`);
    }
  };

  const stopSpinner = (success: boolean) => {
    if (!spinnerActive) return;
    if (renderTimer) {
      clearInterval(renderTimer);
      renderTimer = null;
    }
    if (isTTY) {
      process.stdout.write("\x1b[?25h"); // restore cursor
      const elapsed = fmtElapsed(Date.now() - start);
      if (success) {
        process.stdout.write(
          `\r${ansi.green}✓${ansi.reset} ${label} ${ansi.dim}(${elapsed})${ansi.reset}\x1b[K\n`,
        );
      } else {
        process.stdout.write(
          `\r${ansi.boldRed}✕${ansi.reset} ${label}\x1b[K\n`,
        );
      }
    } else {
      console.log(success ? "done" : "failed");
    }
  };

  const thresholdTimer = setTimeout(startSpinner, thresholdMs);
  // Don't prevent process exit while waiting for threshold
  thresholdTimer.unref();

  try {
    const result = await fn();
    clearTimeout(thresholdTimer);
    stopSpinner(true);
    return result;
  } catch (err) {
    clearTimeout(thresholdTimer);
    stopSpinner(false);
    throw err;
  }
}
