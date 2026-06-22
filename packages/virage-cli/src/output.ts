import { ansi } from "./ansi.js";

const DIVIDER_WIDTH = 60;

export interface Out {
  error(msg: string): void;
  warn(msg: string): void;
  success(msg: string): void;
  info(msg: string): void;
  dim(msg: string): void;
  verbose(msg: string): void;
  debug(msg: string): void;
  section(label: string): void;
  divider(char?: string, width?: number, color?: string): void;
}

export function createOut(verbosity: number): Out {
  return {
    error: (msg) => console.error(`${ansi.boldRed}✕ ${msg}${ansi.reset}`),
    warn: (msg) => console.warn(`${ansi.yellow}⚠ ${msg}${ansi.reset}`),
    success: (msg) => console.log(`${ansi.green}✓ ${msg}${ansi.reset}`),
    info: (msg) => console.log(msg),
    dim: (msg) => console.log(`${ansi.dim}${msg}${ansi.reset}`),
    verbose: (msg) => {
      if (verbosity >= 1) console.log(`${ansi.dim}  ${msg}${ansi.reset}`);
    },
    debug: (msg) => {
      if (verbosity >= 2)
        console.log(`${ansi.dimGray}  [debug] ${msg}${ansi.reset}`);
    },
    section: (label) => {
      const line = `${ansi.dim}${"─".repeat(DIVIDER_WIDTH)}${ansi.reset}`;
      console.log(`\n${line}`);
      console.log(`${ansi.bold}${ansi.cyan} ${label}${ansi.reset}`);
      console.log(line);
    },
    divider: (char = "─", width = DIVIDER_WIDTH, color = ansi.dim) =>
      console.log(`${color}${char.repeat(width)}${ansi.reset}`),
  };
}

// Zero-verbosity fallback for callers that haven't been updated yet.
export const out = createOut(0);
