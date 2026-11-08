// Drizzle Kit reads DATABASE_URL (see .env) instead of a hardcoded URL, so the
// same command works against a local database, CI and a hosted one.
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (copy .env.example to .env)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: false,
});
