import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env.local" });
config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .default("postgresql://collabcode:collabcode@localhost:5432/collabcode"),
  PYTHON_IMAGE: z.string().default("collabcode-python-runner:latest"),
  EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
});

export const env = envSchema.parse(process.env);
