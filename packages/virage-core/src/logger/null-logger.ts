import type { Logger } from "../interfaces/logger.js";

export class NullLogger implements Logger {
  fatal(): void {}
  error(): void {}
  warn(): void {}
  info(): void {}
  success(): void {}
  verbose(): void {}
  debug(): void {}
  trace(): void {}
  silly(): void {}
  withTag(): Logger {
    return this;
  }
}
