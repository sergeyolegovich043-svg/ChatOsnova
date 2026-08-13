import fs from "node:fs/promises";
import path from "node:path";
import pg, { type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.resolve(process.cwd(), "migrations");
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const alreadyApplied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if (alreadyApplied.rowCount) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    console.info(`Applied migration ${file}`);
  }
}
