import { createConsola, type ConsolaInstance } from "consola";
import type { Logger } from "../interfaces/logger.js";

const VERBOSITY_LEVELS = [3, 4, 5, 6, 9, 999] as const;

type ConsolaWithLog = ConsolaInstance & {
  _log(obj: { level: number; message: string; args: unknown[] }): void;
};

export class ConsolaLogger implements Logger {
  private readonly _consola: ConsolaWithLog;

  constructor(instance: ConsolaInstance) {
    this._consola = instance as ConsolaWithLog;
  }

  static create(verbosity: number): ConsolaLogger {
    const level =
      VERBOSITY_LEVELS[Math.min(verbosity, VERBOSITY_LEVELS.length - 1)];
    return new ConsolaLogger(createConsola({ level }));
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
    this._consola._log({ level: 6, message, args }); // custom level 6
  }

  silly(message: string, ...args: unknown[]): void {
    this._consola._log({ level: 999, message, args }); // max verbosity
  }

  withTag(tag: string): Logger {
    return new ConsolaLogger(this._consola.withTag(tag));
  }
}
