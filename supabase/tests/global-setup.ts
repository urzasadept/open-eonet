import type { TestProject } from "vitest/node";
import { localStatus } from "../scripts/local-status.ts";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }
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
