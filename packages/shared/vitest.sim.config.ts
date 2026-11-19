import { defineConfig } from "vitest/config";

// Slow seeded simulations (e.g. bot difficulty balance). Run with `pnpm --filter @lava-sumo/shared sim`.
export default defineConfig({
  test: {
    include: ["test/sim/**/*.sim.test.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 60_000,
    // Print the difficulty table.
    silent: false,
  },
});
