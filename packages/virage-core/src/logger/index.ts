export { ConsolaLogger } from "./consola-logger.js";
export { NullLogger } from "./null-logger.js";

import { ConsolaLogger } from "./consola-logger.js";
import type { Logger } from "../interfaces/logger.js";

export function createLogger(verbosity: number): Logger {
  return ConsolaLogger.create(verbosity);
}
