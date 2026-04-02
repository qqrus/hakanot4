import { pool } from "../lib/db.js";
import {
  createUser,
  ensurePlatformSchema,
  findUserByEmail,
} from "../services/platform-store.js";

type DemoAccountSeed = {
  email: string;
  password: string;
  name: string;
};

const DEMO_ACCOUNTS: DemoAccountSeed[] = [
  { email: "owner.demo@collabcode.local", password: "DemoOwner123!", name: "Demo Owner" },
  { email: "editor.demo@collabcode.local", password: "DemoEditor123!", name: "Demo Editor" },
  { email: "viewer.demo@collabcode.local", password: "DemoViewer123!", name: "Demo Viewer" },
  { email: "jury.demo@collabcode.local", password: "DemoJury123!", name: "Demo Jury" },
];

async function main(): Promise<void> {
  await ensurePlatformSchema();

  let created = 0;
  let skipped = 0;

  for (const account of DEMO_ACCOUNTS) {
    const exists = await findUserByEmail(account.email);
    if (exists) {
      skipped += 1;
      continue;
    }
    await createUser({
      email: account.email,
      password: account.password,
      name: account.name,
    });
    created += 1;
  }

  console.log(`Demo accounts seed finished. created=${created}, skipped=${skipped}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error("Failed to seed demo accounts", error);
  await pool.end();
  process.exit(1);
});
