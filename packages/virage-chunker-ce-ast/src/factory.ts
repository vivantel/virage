import { createHash } from "node:crypto";
import { minimatch } from "minimatch";
import type { ArtifactSet, ArtifactChunker, DocNode } from "./types.js";
import { walkToChunks } from "./chunker.js";
import type { WalkOptions } from "./chunker.js";

export interface BaseOptions {
  maxTokens?: number;
  minTokens?: number;
  overlap?: number;
  adaptiveSize?: boolean;
  recursive?: boolean;
  ignore?: string[];
}

/** Returned by every native chunker binding. Rust reads the file, computes
 *  the SHA-256 hash, and returns all four fields so JS never holds the file
 *  bytes. */
export interface ParseResult {
  tree: string;
  hash: string;
  size: number;
  modifiedMs: number;
}

export interface NativeChunkerDef<TOptions extends BaseOptions> {
  /** npm package name, used as the `strategy` field in ArtifactSet. */
  name: string;
  /** Semver version string (e.g. "0.1.3"). Used to compute generator IDs. */
  version: string;
  /** "pdf" | "md" | "docx" | "xlsx" etc. — becomes `sourceFormat`. */
  sourceFormat: string;
  /** Glob patterns this chunker accepts, e.g. ["**\/*.pdf"]. */
  patterns: string[];
  /**
   * Return the native napi binding object. Called at most once per chunker
   * instance (lazily, on the first `chunk()` call).
   */
  loadBinding: () => Record<string, (...args: unknown[]) => unknown>;
  /**
   * Invoke the correct function on the already-loaded binding, passing the
   * file path. Rust reads the file and returns a ParseResult — no file data
   * crosses the JS/Rust boundary.
   */
  callNative: (
    binding: ReturnType<NativeChunkerDef<TOptions>["loadBinding"]>,
    filePath: string,
    opts: TOptions,
  ) => ParseResult;
  /** Format-specific WalkOptions defaults. Spread before user opts so user opts win. */
  extraWalkOpts?: (opts: TOptions) => Partial<WalkOptions>;
  /** Optional post-walk hook for format-specific enrichment (XLSX cell refs, etc.). */
  enrich?: (sets: ArtifactSet[], docNode: DocNode, opts: TOptions) => ArtifactSet[];
}

function makeGeneratorId(name: string, version: string, role: string, opts: BaseOptions): string {
  const fp = JSON.stringify({
    maxTokens: opts.maxTokens,
    minTokens: opts.minTokens,
    overlap: opts.overlap,
    adaptiveSize: opts.adaptiveSize,
    recursive: opts.recursive,
  });
  return createHash("sha256")
    .update(`${name}@${version}:${role}:${fp}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Factory that eliminates boilerplate common to every native-binary chunker:
 * lazy binding load, walkToChunks, and optional enrich hook.
 * File I/O and hashing happen inside Rust via callNative.
 *
 * Usage:
 *   export const createChunker = createNativeChunker<MyOptions>({ ... });
 */
export function createNativeChunker<TOptions extends BaseOptions>(
  def: NativeChunkerDef<TOptions>,
): (opts?: TOptions) => ArtifactChunker {
  return (opts?: TOptions): ArtifactChunker => {
    const resolvedOpts = (opts ?? {}) as TOptions;
    const ignore = resolvedOpts.ignore ?? [];
    let _binding: ReturnType<NativeChunkerDef<TOptions>["loadBinding"]> | null = null;

    const sparseTextGeneratorId = makeGeneratorId(def.name, def.version, "sparse", resolvedOpts);
    const metadataGeneratorId = makeGeneratorId(def.name, def.version, "meta", resolvedOpts);

    function getBinding() {
      if (_binding == null) {
        _binding = def.loadBinding();
      }
      return _binding;
    }

    return {
      name: def.name,
      version: def.version,
      patterns: def.patterns,
      sparseTextGeneratorId,
      metadataGeneratorId,

      async chunk(filePath: string, commitHash: string): Promise<ArtifactSet[]> {
        const binding = getBinding();
        const result = def.callNative(binding, filePath, resolvedOpts);
        const docNode = JSON.parse(result.tree) as DocNode;

        const extra = def.extraWalkOpts ? def.extraWalkOpts(resolvedOpts) : {};
        const sets = walkToChunks(docNode, {
          ...extra,
          ...(resolvedOpts.maxTokens != null
            ? { maxTokens: resolvedOpts.maxTokens }
            : {}),
          ...(resolvedOpts.minTokens != null
            ? { minTokens: resolvedOpts.minTokens }
            : {}),
          ...(resolvedOpts.overlap != null
            ? { overlap: resolvedOpts.overlap }
            : {}),
          ...(resolvedOpts.adaptiveSize != null
            ? { adaptiveSize: resolvedOpts.adaptiveSize }
            : {}),
          ...(resolvedOpts.recursive != null
            ? { recursive: resolvedOpts.recursive }
            : {}),
          sourceFile: filePath,
          sourceFormat: def.sourceFormat,
          commitHash,
          strategy: def.name,
          sparseTextGeneratorId,
          metadataGeneratorId,
          fileHash: result.hash,
          fileSizeBytes: result.size,
          fileModifiedAt: new Date(result.modifiedMs).toISOString(),
        });

        return def.enrich ? def.enrich(sets, docNode, resolvedOpts) : sets;
      },

      async canProcess(filePath: string): Promise<boolean> {
        if (ignore.some((p) => minimatch(filePath, p, { matchBase: true }))) {
          return false;
        }
        return def.patterns.some((p) =>
          minimatch(filePath, p, { matchBase: true }),
        );
      },
    };
  };
}
