import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "supabase",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
});
