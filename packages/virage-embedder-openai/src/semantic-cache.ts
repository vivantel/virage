export interface SemanticCacheConfig {
  strategy: "exact" | "semantic";
  /** Cosine similarity threshold for semantic cache hits. Defaults to 0.95. */
  similarityThreshold?: number;
  /** Max cache size in MB (in-memory LRU). Defaults to 500. */
  maxSizeMB?: number;
  /** Persistence backend. Defaults to "memory". */
  persistence?: "memory" | "sqlite";
  /** Path to SQLite database file. Defaults to ".rag-embedding-cache.db". */
  sqlitePath?: string;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Simple SHA-256-free hash for exact cache key (djb2). */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

type SqliteDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    run: (...args: unknown[]) => void;
  };
};

export class SemanticCache {
  private readonly config: Required<SemanticCacheConfig>;
  /** In-memory LRU store: key → embedding */
  private readonly lru = new Map<string, number[]>();
  /** Semantic store: [embedding, originalKey][] for cosine comparison */
  private semantic: Array<[number[], string]> = [];
  private db: SqliteDb | null = null;
  private dbReady = false;

  constructor(config: SemanticCacheConfig) {
    this.config = {
      strategy: config.strategy,
      similarityThreshold: config.similarityThreshold ?? 0.95,
      maxSizeMB: config.maxSizeMB ?? 500,
      persistence: config.persistence ?? "memory",
      sqlitePath: config.sqlitePath ?? ".rag-embedding-cache.db",
    };
  }

  async get(
    text: string,
    embed: (t: string) => Promise<number[]>,
  ): Promise<number[] | null> {
    const key = hashText(text);

    // 1. Exact in-memory hit
    const memHit = this.lru.get(key);
    if (memHit) return memHit;

    // 2. SQLite exact hit
    if (this.config.persistence === "sqlite") {
      const dbHit = await this.dbGet(key);
      if (dbHit) {
        this.lruPut(key, dbHit);
        return dbHit;
      }
    }

    // 3. Semantic hit (needs query embedding)
    if (this.config.strategy === "semantic" && this.semantic.length > 0) {
      const queryEmb = await embed(text);
      let bestSim = -1;
      let bestEmb: number[] | null = null;

      for (const [emb] of this.semantic) {
        const sim = cosineSimilarity(queryEmb, emb);
        if (sim > bestSim) {
          bestSim = sim;
          bestEmb = emb;
        }
      }

      if (bestSim >= this.config.similarityThreshold && bestEmb) {
        return bestEmb;
      }
    }

    return null;
  }

  async set(text: string, embedding: number[]): Promise<void> {
    const key = hashText(text);
    this.lruPut(key, embedding);

    if (this.config.strategy === "semantic") {
      this.semantic.push([embedding, key]);
    }

    if (this.config.persistence === "sqlite") {
      await this.dbSet(key, embedding);
    }
  }

  private lruPut(key: string, embedding: number[]): void {
    // Evict oldest entry if we're over size (rough approximation)
    const maxEntries = Math.floor(
      (this.config.maxSizeMB * 1024 * 1024) /
        (embedding.length * 4 + key.length * 2),
    );
    if (this.lru.size >= maxEntries) {
      const firstKey = this.lru.keys().next().value;
      if (firstKey !== undefined) this.lru.delete(firstKey);
    }
    this.lru.delete(key); // move to end (LRU update)
    this.lru.set(key, embedding);
  }

  private async initDb(): Promise<SqliteDb | null> {
    if (this.dbReady) return this.db;
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — better-sqlite3 is an optional peer dependency
      const { default: Database } = (await import("better-sqlite3")) as {
        default: new (path: string) => SqliteDb;
      };
      const db = new Database(this.config.sqlitePath);
      db.exec(
        `CREATE TABLE IF NOT EXISTS embeddings (
           key TEXT PRIMARY KEY,
           embedding BLOB NOT NULL
         )`,
      );
      this.db = db;
      this.dbReady = true;
    } catch {
      console.warn(
        "[rag-embedder-openai] better-sqlite3 not available — cache will use memory only.",
      );
      this.dbReady = true; // prevent repeated attempts
    }
    return this.db;
  }

  private async dbGet(key: string): Promise<number[] | null> {
    const db: SqliteDb | null = await this.initDb();
    if (!db) return null;
    try {
      const row = db
        .prepare("SELECT embedding FROM embeddings WHERE key = ?")
        .get(key) as { embedding: Buffer } | undefined;
      if (!row) return null;
      return Array.from(new Float32Array(row.embedding.buffer));
    } catch {
      return null;
    }
  }

  private async dbSet(key: string, embedding: number[]): Promise<void> {
    const db = await this.initDb();
    if (!db) return;
    try {
      const buf = Buffer.from(new Float32Array(embedding).buffer);
      db.prepare(
        "INSERT OR REPLACE INTO embeddings (key, embedding) VALUES (?, ?)",
      ).run(key, buf);
    } catch {
      // Non-fatal
    }
  }
}
