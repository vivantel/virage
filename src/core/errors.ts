export class RagError extends Error {
  suggestion?: string;

  constructor(
    message: string,
    options?: { suggestion?: string; cause?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = this.constructor.name;
    this.suggestion = options?.suggestion;
  }
}

export class ConfigError extends RagError {}
export class ChunkError extends RagError {}
export class EmbedError extends RagError {}
export class UploadError extends RagError {}
