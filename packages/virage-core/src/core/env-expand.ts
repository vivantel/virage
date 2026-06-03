/** Recursively expands ${VAR_NAME} patterns in string values using process.env. */
export function expandEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        console.warn(`⚠️  Environment variable \${${name}} is not set`);
        return "";
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        expandEnvVars(v),
      ]),
    );
  }
  return value;
}
