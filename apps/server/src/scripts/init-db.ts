import { pool } from "../lib/db.js";
import { ensurePlatformSchema } from "../services/platform-store.js";

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      language TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      participant_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await ensurePlatformSchema();

  console.log("Database schema is ready.");
  await pool.end();
}

main().catch(async (error) => {
  console.error("Failed to initialize database", error);
  await pool.end();
  process.exit(1);
});
