import "./config.js";
import { pool, runMigrations } from "./db.js";
import { backfillEmbeddings, runOutboxBatch } from "./services/outbox-worker.js";

let stopping = false;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function start() {
  await runMigrations();
  console.info("BarsikChat AI outbox worker started");
  let backfillCounter = 0;
  while (!stopping) {
    const count = await runOutboxBatch();
    backfillCounter += 1;
    if (backfillCounter >= 30) {
      await backfillEmbeddings();
      backfillCounter = 0;
    }
    if (count === 0) await wait(2_000);
  }
}

async function shutdown() {
  stopping = true;
  await pool.end();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

start().catch((error) => {
  console.error("BarsikChat AI worker failed", error);
  process.exitCode = 1;
});
