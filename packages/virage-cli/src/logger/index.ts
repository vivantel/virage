export { ConsolaLogger } from "./consola-logger.js";

import { ConsolaLogger } from "./consola-logger.js";
import type { Logger } from "@vivantel/virage-core";

export function createLogger(verbosity: number): Logger {
  return ConsolaLogger.create(verbosity);
}
