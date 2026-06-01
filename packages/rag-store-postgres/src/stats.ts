import type { IndexStats } from "@vivantel/rag-core";
import pg from "pg";

export async function getIndexStats(
  pool: pg.Pool,
  table: string,
): Promise<IndexStats> {
  const client = await pool.connect();
  try {
    return await computeIndexStats(client, table);
  } finally {
    client.release();
  }
}

async function computeIndexStats(
  client: pg.PoolClient,
  table: string,
): Promise<IndexStats> {
  const suggestions: string[] = [];

  // Total vector count
  const countRes = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ${table}`,
  );
  const totalVectors = parseInt(countRes.rows[0]?.count ?? "0", 10);

  // Index type and definition
  const indexRes = await client.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
    [table],
  );

  let indexType: IndexStats["indexType"] = "unknown";
  for (const row of indexRes.rows) {
    const def = row.indexdef.toLowerCase();
    if (def.includes("hnsw")) {
      indexType = "hnsw";
      break;
    } else if (def.includes("ivfflat")) {
      indexType = "ivfflat";
      break;
    } else if (def.includes("btree") || def.includes("flat")) {
      indexType = "flat";
    }
  }

  // Dead tuple fraction and index age from pg_stat_user_tables
  const statRes = await client.query<{
    n_live_tup: string;
    n_dead_tup: string;
    last_vacuum: string | null;
    last_autovacuum: string | null;
  }>(
    `SELECT n_live_tup, n_dead_tup, last_vacuum, last_autovacuum
     FROM pg_stat_user_tables WHERE relname = $1`,
    [table],
  );

  const statRow = statRes.rows[0];
  const nLive = parseInt(statRow?.n_live_tup ?? "0", 10);
  const nDead = parseInt(statRow?.n_dead_tup ?? "0", 10);
  const deadTupleFraction = nLive + nDead > 0 ? nDead / (nLive + nDead) : 0;

  const lastVacuum =
    statRow?.last_vacuum ?? statRow?.last_autovacuum ?? null;
  const indexAgeHours = lastVacuum
    ? (Date.now() - new Date(lastVacuum).getTime()) / 3_600_000
    : -1;

  // ANN recall@10: compare exact vs index results for a zero vector
  const annRecallAt10 = await computeAnnRecall(client, table);

  // Build suggestions
  if (deadTupleFraction > 0.1) {
    suggestions.push(
      `REINDEX recommended: ${(deadTupleFraction * 100).toFixed(0)}% dead tuples in "${table}"`,
    );
  }
  if (indexType === "ivfflat" && totalVectors > 100_000) {
    suggestions.push(
      `Consider switching to HNSW index for better recall at ${totalVectors.toLocaleString()} vectors`,
    );
  }
  if (indexAgeHours > 168) {
    suggestions.push(
      `Index age ${Math.round(indexAgeHours)} hours — consider VACUUM ANALYZE`,
    );
  }
  if (suggestions.length === 0) {
    suggestions.push("Index looks healthy");
  }

  return {
    totalVectors,
    indexType,
    annRecallAt10,
    indexAgeHours: Math.round(indexAgeHours * 10) / 10,
    deadTupleFraction: Math.round(deadTupleFraction * 1000) / 1000,
    suggestions,
  };
}

async function computeAnnRecall(
  client: pg.PoolClient,
  table: string,
): Promise<number> {
  // Check if table has any rows and an embedding column
  const colRes = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = $1 AND column_name = 'embedding'`,
    [table],
  );
  if (colRes.rows.length === 0) return -1;

  const countRes = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ${table}`,
  );
  const total = parseInt(countRes.rows[0]?.count ?? "0", 10);
  if (total < 10) return -1; // Not enough data

  try {
    // Get dimension from a sample embedding
    const sampleRes = await client.query<{ dim: number }>(
      `SELECT array_length(embedding::real[], 1) AS dim FROM ${table} LIMIT 1`,
    );
    const dim = sampleRes.rows[0]?.dim;
    if (!dim) return -1;

    // Use a zero vector for comparison
    const zeroVec = `[${Array(dim).fill(0).join(",")}]`;

    // Exact results (no index, brute-force)
    const exactRes = await client.query<{ id: number }>(
      `SELECT id FROM ${table}
       ORDER BY embedding::vector <=> $1::vector
       LIMIT 10`,
      [zeroVec],
    );
    const exactIds = new Set(exactRes.rows.map((r: { id: number }) => r.id));

    // ANN results (uses index)
    const annRes = await client.query<{ id: number }>(
      `SELECT id FROM ${table}
       ORDER BY embedding <=> $1::vector
       LIMIT 10`,
      [zeroVec],
    );
    const annIds = annRes.rows.map((r: { id: number }) => r.id);

    const hits = annIds.filter((id) => exactIds.has(id)).length;
    return hits / Math.max(exactIds.size, 1);
  } catch {
    return -1;
  }
}
