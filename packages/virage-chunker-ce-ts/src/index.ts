import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import * as ts from "typescript";
import { minimatch } from "minimatch";
import { walkToChunks } from "@vivantel/virage-chunker-ce-ast";
import type { ArtifactChunker, ArtifactSet, DocNode, DocNodeAttrs, BaseOptions } from "@vivantel/virage-chunker-ce-ast";

const NAME = "@vivantel/virage-chunker-ce-ts";
const VERSION = "0.1.0";

export type TsChunkerOptions = BaseOptions;

function makeGeneratorId(role: string, opts: TsChunkerOptions): string {
  const fp = JSON.stringify({
    maxTokens: opts.maxTokens,
    minTokens: opts.minTokens,
    overlap: opts.overlap,
    adaptiveSize: opts.adaptiveSize,
    recursive: opts.recursive,
  });
  return createHash("sha256")
    .update(`${NAME}@${VERSION}:${role}:${fp}`)
    .digest("hex")
    .slice(0, 16);
}

function emptyAttrs(byteStart = 0, byteEnd = 0): DocNodeAttrs {
  return { byteStart, byteEnd };
}

/**
 * Build a ViDoc DocNode from a TypeScript/JavaScript source file.
 * Top-level declarations become sections; imports form a preamble code node.
 */
function buildDocNode(
  filePath: string,
  content: string,
): DocNode {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const children: DocNode[] = [];

  // Gather import declarations as a single preamble code node.
  const importLines: string[] = [];
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) ||
      ts.isImportEqualsDeclaration(stmt)
    ) {
      importLines.push(stmt.getText(sourceFile).trim());
    }
  }
  if (importLines.length > 0) {
    const importText = importLines.join("\n");
    children.push({
      type: "code",
      text: importText,
      attrs: {
        ...emptyAttrs(sourceFile.getStart(), sourceFile.getEnd()),
        codeLanguage: "typescript",
        sourceFormat: "ts",
      },
    });
  }

  // Each top-level non-import declaration becomes a section.
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) ||
      ts.isImportEqualsDeclaration(stmt)
    ) {
      continue;
    }

    const start = stmt.getStart(sourceFile);
    const end = stmt.getEnd();
    const text = content.slice(start, end);
    const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(end).line + 1;

    let heading: string;

    if (ts.isFunctionDeclaration(stmt) || ts.isFunctionExpression(stmt)) {
      heading = stmt.name ? stmt.name.text : "(anonymous function)";
    } else if (ts.isClassDeclaration(stmt)) {
      heading = stmt.name ? stmt.name.text : "(anonymous class)";
    } else if (ts.isInterfaceDeclaration(stmt)) {
      heading = stmt.name.text;
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      heading = stmt.name.text;
    } else if (ts.isEnumDeclaration(stmt)) {
      heading = stmt.name.text;
    } else if (ts.isVariableStatement(stmt)) {
      const decls = stmt.declarationList.declarations;
      const names = decls
        .map((d) => (ts.isIdentifier(d.name) ? d.name.text : ""))
        .filter(Boolean);
      heading = names.join(", ") || "(variable)";
    } else if (ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)) {
      heading = "export";
    } else {
      heading = "(statement)";
    }

    const sectionNode: DocNode = {
      type: "section",
      attrs: {
        byteStart: start,
        byteEnd: end,
        lineStart: startLine,
        lineEnd: endLine,
        headingLevel: 1,
        breadcrumb: [heading],
        codeLanguage: "typescript",
        sourceFormat: "ts",
      },
      children: [
        {
          type: "heading",
          text: heading,
          attrs: {
            byteStart: start,
            byteEnd: start,
            headingLevel: 1,
          },
        },
        {
          type: "code",
          text,
          attrs: {
            byteStart: start,
            byteEnd: end,
            lineStart: startLine,
            lineEnd: endLine,
            codeLanguage: "typescript",
          },
        },
      ],
    };

    children.push(sectionNode);
  }

  return {
    type: "document",
    attrs: emptyAttrs(0, content.length),
    children,
  };
}

export function createChunker(opts?: TsChunkerOptions): ArtifactChunker {
  const resolvedOpts = opts ?? {};
  const ignore = resolvedOpts.ignore ?? [];
  const sparseTextGeneratorId = makeGeneratorId("sparse", resolvedOpts);
  const metadataGeneratorId = makeGeneratorId("meta", resolvedOpts);

  return {
    name: NAME,
    version: VERSION,
    patterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    sparseTextGeneratorId,
    metadataGeneratorId,

    async chunk(filePath: string, commitHash: string): Promise<ArtifactSet[]> {
      const content = await readFile(filePath, "utf-8");
      const fileStat = await stat(filePath);
      const fileHash = createHash("sha256").update(content).digest("hex").slice(0, 16);

      const docNode = buildDocNode(filePath, content);

      return walkToChunks(docNode, {
        sourceFile: filePath,
        sourceFormat: "ts",
        commitHash,
        strategy: NAME,
        sparseTextGeneratorId,
        metadataGeneratorId,
        ...(resolvedOpts.maxTokens != null ? { maxTokens: resolvedOpts.maxTokens } : {}),
        ...(resolvedOpts.minTokens != null ? { minTokens: resolvedOpts.minTokens } : {}),
        ...(resolvedOpts.overlap != null ? { overlap: resolvedOpts.overlap } : {}),
        ...(resolvedOpts.adaptiveSize != null ? { adaptiveSize: resolvedOpts.adaptiveSize } : {}),
        ...(resolvedOpts.recursive != null ? { recursive: resolvedOpts.recursive } : {}),
        fileHash,
        fileSizeBytes: fileStat.size,
        fileModifiedAt: fileStat.mtime.toISOString(),
      });
    },

    async canProcess(filePath: string): Promise<boolean> {
      if (ignore.some((p) => minimatch(filePath, p, { matchBase: true }))) {
        return false;
      }
      return ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"].some(
        (p) => minimatch(filePath, p, { matchBase: true }),
      );
    },
  };
}
