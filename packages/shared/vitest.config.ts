import { configDefaults, defineConfig } from "vitest/config";

// Default `pnpm test`: fast unit tests only. Slow seeded sims run via `pnpm sim` (vitest.sim.config.ts).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "test/sim/**"],
  },
});
