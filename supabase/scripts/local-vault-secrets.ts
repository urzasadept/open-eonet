// Stores the Vault secrets that let pg_cron call the local `sync` Edge Function.
// Run after `supabase start` or `supabase db reset`.
import { execFileSync } from "node:child_process";
import { localStatus } from "./local-status.ts";

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const secretKey = localStatus().SECRET_KEY;
if (!secretKey) throw new Error("No SECRET_KEY in `supabase status`; is the local stack running?");

// `supabase db query` runs a single statement per call.
const statements = [
  "delete from vault.secrets where name in ('project_url', 'secret_key')",
  "select vault.create_secret('http://api.supabase.internal:8000', 'project_url')",
  `select vault.create_secret(${literal(secretKey)}, 'secret_key')`,
];

for (const sql of statements) {
  execFileSync("supabase", ["db", "query", "--local", sql], { stdio: "ignore" });
}
console.log("Stored project_url and secret_key in the local Vault.");
