import { execFileSync } from "node:child_process";

/** The local stack's URLs and keys, as printed by `supabase status -o env`. */
export function localStatus(): Record<string, string> {
  const output = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.match(/^(\w+)="(.*)"$/))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
}
