import { ChunkStrategy, Chunk } from "../../interfaces/index.js";

export interface MarkdownHeadersOptions {
  minChunkSize?: number;
  maxChunkSize?: number;
}

export function markdownHeadersStrategy(
  options: MarkdownHeadersOptions = {},
): ChunkStrategy {
  const minChunkSize = options.minChunkSize ?? 100;
  const maxChunkSize = options.maxChunkSize ?? 8000;

  return {
    name: "markdown-headers",

    async chunk(text: string, filePath?: string): Promise<Chunk[]> {
      const chunks: Chunk[] = [];
      const lines = text.split("\n");

      let currentChunk: string[] = [];
      let currentHeader = "";
      let currentHeaderLevel = 0;

      for (const line of lines) {
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

        if (headerMatch) {
          // Save previous chunk if not empty
          if (currentChunk.length > 0) {
            const content = currentChunk.join("\n").trim();
            if (content.length >= minChunkSize) {
              chunks.push({
                content,
                metadata: {
                  strategy: this.name,
                  header: currentHeader,
                  header_level: currentHeaderLevel,
                  source_file: filePath,
                },
                sourceFile: filePath || "unknown",
                commitHash: "",
              });
            }
          }

          // Start new chunk
          currentHeaderLevel = headerMatch[1].length;
          currentHeader = headerMatch[2];
          currentChunk = [line];
        } else {
          currentChunk.push(line);
        }

        // Prevent chunks from getting too large
        const currentSize = currentChunk.join("\n").length;
        if (currentSize > maxChunkSize && currentChunk.length > 10) {
          const content = currentChunk.join("\n").trim();
          chunks.push({
            content,
            metadata: {
              strategy: this.name,
              header: currentHeader,
              header_level: currentHeaderLevel,
              truncated: true,
            },
            sourceFile: filePath || "unknown",
            commitHash: "",
          });
          currentChunk = [];
        }
      }

      // Last chunk
      if (currentChunk.length > 0) {
        const content = currentChunk.join("\n").trim();
        if (content.length >= minChunkSize) {
          chunks.push({
            content,
            metadata: {
              strategy: this.name,
              header: currentHeader,
              header_level: currentHeaderLevel,
              source_file: filePath,
              is_last: true,
            },
            sourceFile: filePath || "unknown",
            commitHash: "",
          });
        }
      }

      return chunks;
    },

    extractMetadata(text: string, _filePath?: string): Record<string, unknown> {
      const headerMatch = text.match(/^(#{1,6})\s+(.+)$/m);
      return {
        strategy: this.name,
        has_headers: !!headerMatch,
        first_header: headerMatch?.[2],
        line_count: text.split("\n").length,
      };
    },
  };
}
