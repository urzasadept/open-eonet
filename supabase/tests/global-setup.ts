import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }
}

function localStatus(): Record<string, string> {
  const output = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.match(/^(\w+)="(.*)"$/))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
}

export default function setup(project: TestProject) {
  const env = process.env;
  const status =
    env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY
      ? undefined
      : localStatus();
  project.provide("supabaseUrl", env.SUPABASE_URL ?? status?.API_URL ?? "");
  project.provide("publishableKey", env.SUPABASE_PUBLISHABLE_KEY ?? status?.PUBLISHABLE_KEY ?? "");
  project.provide("secretKey", env.SUPABASE_SECRET_KEY ?? status?.SECRET_KEY ?? "");
}
