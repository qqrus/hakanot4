import { createId } from "../lib/id.js";
import { pool } from "../lib/db.js";
import { demoRoom } from "../services/demo-data.js";

async function main(): Promise<void> {
  await pool.query(
    `
      INSERT INTO rooms (id, name, file_name, language)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          file_name = EXCLUDED.file_name,
          language = EXCLUDED.language
    `,
    [demoRoom.roomId, demoRoom.name, demoRoom.fileName, demoRoom.language],
  );

  await pool.query(
    `
      INSERT INTO session_events (id, room_id, type, message)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING
    `,
    [createId("evt"), demoRoom.roomId, "system", "Демо-комната подготовлена для CollabCode AI"],
  );

  console.log("Demo room is seeded.");
  await pool.end();
}

main().catch(async (error) => {
  console.error("Failed to seed demo data", error);
  await pool.end();
  process.exit(1);
});
