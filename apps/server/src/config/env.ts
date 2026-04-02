import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const rootEnvPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
const rootEnvLocalPath = fileURLToPath(new URL("../../../../.env.local", import.meta.url));

// Load root env files first (monorepo root), then allow local workspace overrides.
config({ path: rootEnvPath });
config({ path: rootEnvLocalPath, override: true });
config();
config({ path: ".env.local", override: true });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .default("postgresql://collabcode:collabcode@localhost:5432/collabcode"),
  PYTHON_IMAGE: z.string().default("collabcode-python-runner:latest"),
  EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  JWT_SECRET: z.string().min(16).default("change-me-super-secret-key"),
  OPENROUTER_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);
