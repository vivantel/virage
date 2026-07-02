// Wrapper around the `tokenizers` npm package (HuggingFace Rust tokenizers bindings).
// Dynamic import is used so the package is optional at load time — the embedder
// constructor defers tokenizer loading to preWarm().

export interface TokenizerOutput {
  inputIds: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
}

export interface BatchTokenizerOutput {
  inputIds: number[][];
  attentionMask: number[][];
  tokenTypeIds: number[][];
  maxLength: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TokenizersModule = { AutoTokenizer: any };

let tokenizersModule: TokenizersModule | null = null;

async function getTokenizers(): Promise<TokenizersModule> {
  if (!tokenizersModule) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tokenizersModule = (await import("tokenizers")) as any;
  }
  return tokenizersModule!;
}

export class OnnxTokenizer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private inner: any;
  private readonly maxLen: number;

  private constructor(inner: unknown, maxLen: number) {
    this.inner = inner;
    this.maxLen = maxLen;
  }

  static async fromFile(path: string, maxLen: number): Promise<OnnxTokenizer> {
    const { AutoTokenizer } = await getTokenizers();
    const inner = await AutoTokenizer.fromFile(path);
    return new OnnxTokenizer(inner, maxLen);
  }

  encode(text: string): TokenizerOutput {
    const enc = this.inner.encode(text, null, { addSpecialTokens: true });
    const ids: number[] = Array.from(enc.getIds() as Uint32Array).slice(
      0,
      this.maxLen,
    );
    const mask: number[] = Array.from(
      enc.getAttentionMask() as Uint32Array,
    ).slice(0, this.maxLen);
    const typeIds: number[] = Array.from(enc.getTypeIds() as Uint32Array).slice(
      0,
      this.maxLen,
    );
    return { inputIds: ids, attentionMask: mask, tokenTypeIds: typeIds };
  }

  encodeBatch(texts: string[]): BatchTokenizerOutput {
    const encoded = texts.map((t) => this.encode(t));
    const maxLength = Math.max(...encoded.map((e) => e.inputIds.length));
    const inputIds = encoded.map((e) => pad(e.inputIds, maxLength, 0));
    const attentionMask = encoded.map((e) =>
      pad(e.attentionMask, maxLength, 0),
    );
    const tokenTypeIds = encoded.map((e) => pad(e.tokenTypeIds, maxLength, 0));
    return { inputIds, attentionMask, tokenTypeIds, maxLength };
  }
}

function pad(arr: number[], length: number, value: number): number[] {
  const result = arr.slice(0, length);
  while (result.length < length) result.push(value);
  return result;
}
