// `pnpm local`: starts everything needed to use the app locally, then runs the web dev server.
// Safe to re-run: each step skips or repeats harmlessly when already done.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { localStatus } from "./local-status.ts";
import { storeLocalVaultSecrets } from "./local-vault-secrets.ts";

const run = (command: string, args: string[], env?: Record<string, string>) =>
  execFileSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } });

function step(title: string) {
  console.log(`\n▸ ${title}`);
}

function mirroredEventCount(): number {
  const output = execFileSync(
    "supabase",
    ["db", "query", "--local", "-o", "json", "select count(*)::int as n from events"],
    { encoding: "utf8" },
  );
  return (JSON.parse(output) as { rows: { n: number }[] }).rows[0]?.n ?? 0;
}

try {
  execFileSync("docker", ["info"], { stdio: "ignore" });
} catch {
  console.error("Docker isn't running. Start it (for example, open OrbStack) and try again.");
  process.exit(1);
}

step("Installing dependencies");
run("pnpm", ["install"]);

step("Starting local Supabase (migrations apply on first start)");
run("supabase", ["start"]);
const status = localStatus();
const { API_URL, PUBLISHABLE_KEY, SECRET_KEY } = status;
if (!API_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
  throw new Error("`supabase status` is missing API_URL, PUBLISHABLE_KEY or SECRET_KEY.");
}

step("Storing the Vault secrets for the sync schedule");
storeLocalVaultSecrets(SECRET_KEY);

const events = mirroredEventCount();
if (events === 0) {
  step("Mirror is empty: running the Backfill (about 2 minutes)");
  run("pnpm", ["backfill"], { SUPABASE_URL: API_URL, SUPABASE_SECRET_KEY: SECRET_KEY });
} else {
  step(`Mirror holds ${events} Events; skipping the Backfill (run \`pnpm backfill\` to refresh)`);
}

// The scheduled syncs reach the function only while `supabase functions serve` runs.
const serveLog = "supabase/.temp/functions-serve.log";
mkdirSync(dirname(serveLog), { recursive: true });
step(`Serving the sync Edge Function (log: ${serveLog})`);
const functions = spawn("supabase", ["functions", "serve"], {
  stdio: ["ignore", openSync(serveLog, "w"), openSync(serveLog, "a")],
});

step("Starting the web app. Ctrl+C stops it and the function server; `supabase stop` stops the");
console.log("  database.");
const web = spawn("pnpm", ["--filter", "@eonet/web", "dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_SUPABASE_URL: API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
  },
});

const children = [functions, web];
for (const child of children) {
  child.on("exit", (code) => {
    for (const other of children) if (other !== child) other.kill("SIGTERM");
    process.exitCode = code ?? 0;
  });
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const child of children) child.kill("SIGTERM");
  });
}
