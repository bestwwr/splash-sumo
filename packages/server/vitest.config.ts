import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Workers-runtime tests (worker.test.ts only). Pure RoomLogic tests run in plain Node: vitest.node.config.ts.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
  test: { include: ["test/worker.test.ts"] },
});
