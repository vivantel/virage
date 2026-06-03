import { createConsola, type ConsolaInstance } from "consola";
import type { Logger } from "../interfaces/logger.js";

const VERBOSITY_LEVELS = [3, 4, 5, 6, 9, 999] as const;

type ConsolaWithLog = ConsolaInstance & {
  _log(obj: {
    level: number;
    message: string;
    args: unknown[];
    date: Date;
  }): void;
};

export class ConsolaLogger implements Logger {
  private readonly _consola: ConsolaWithLog;

  constructor(instance: ConsolaInstance) {
    this._consola = instance as ConsolaWithLog;
  }

  static create(verbosity: number): ConsolaLogger {
    const level =
      VERBOSITY_LEVELS[Math.min(verbosity, VERBOSITY_LEVELS.length - 1)];
    const instance = createConsola({ level });

    // FancyReporter.formatLogObj captures `new Error().stack` for trace-type
    // logs and renders it. Patch formatStack to strip consola internals and the
    // ConsolaLogger bridge frame so only application frames appear.
    const reporter = (
      instance as unknown as {
        options?: {
          reporters?: Array<{
            formatStack?: (
              stack: string,
              message: string,
              opts?: unknown,
            ) => string;
          }>;
        };
      }
    ).options?.reporters?.[0];
    if (typeof reporter?.formatStack === "function") {
      const orig = reporter.formatStack.bind(reporter);
      reporter.formatStack = (stack, message, opts) => {
        const filtered = stack
          .split("\n")
          .filter(
            (line) =>
              !line.includes("node_modules/consola") &&
              !line.includes("consola-logger"),
          )
          .join("\n");
        return orig(filtered, message, opts);
      };
    }

    return new ConsolaLogger(instance as ConsolaWithLog);
  }

  fatal(message: string, ...args: unknown[]): void {
    this._consola.fatal(message, ...args);
  }
  error(message: string, ...args: unknown[]): void {
    this._consola.error(message, ...args);
  }
  warn(message: string, ...args: unknown[]): void {
    this._consola.warn(message, ...args);
  }
  info(message: string, ...args: unknown[]): void {
    this._consola.info(message, ...args);
  }
  success(message: string, ...args: unknown[]): void {
    this._consola.success(message, ...args);
  }

  verbose(message: string, ...args: unknown[]): void {
    this._consola.debug(message, ...args); // level 4
  }

  debug(message: string, ...args: unknown[]): void {
    this._consola.trace(message, ...args); // level 5
  }

  trace(message: string, ...args: unknown[]): void {
    this._consola._log({ level: 6, message, args, date: new Date() });
  }

  silly(message: string, ...args: unknown[]): void {
    this._consola._log({ level: 999, message, args, date: new Date() });
  }

  withTag(tag: string): Logger {
    return new ConsolaLogger(this._consola.withTag(tag));
  }
}
