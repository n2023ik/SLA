/** Loads the local backend credentials so the suite can read the real dataset. */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

if (!process.env["SUPABASE_URL"] && process.env["VITE_SUPABASE_URL"]) {
  process.env["SUPABASE_URL"] = process.env["VITE_SUPABASE_URL"];
}
if (!process.env["SUPABASE_PUBLISHABLE_KEY"] && process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]) {
  process.env["SUPABASE_PUBLISHABLE_KEY"] = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
}
