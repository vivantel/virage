import { ansi } from "./progress/progress-bar.js";

export const out = {
  success: (msg: string) => console.log(`${ansi.green}✓ ${msg}${ansi.reset}`),
  error: (msg: string) => console.error(`${ansi.boldRed}✕ ${msg}${ansi.reset}`),
  warn: (msg: string) => console.log(`${ansi.yellow}⚠ ${msg}${ansi.reset}`),
  info: (msg: string) => console.log(msg),
  section: (msg: string) => console.log(`\n${ansi.bold}${msg}${ansi.reset}`),
  dim: (msg: string) => console.log(`${ansi.dim}${msg}${ansi.reset}`),
  sep: (char = "─", width = 50) =>
    console.log(`${ansi.dim}${char.repeat(width)}${ansi.reset}`),
};
