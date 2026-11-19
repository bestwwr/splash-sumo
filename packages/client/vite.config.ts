import { defineConfig, loadEnv } from "vite";
import { assertProdServerUrl } from "./src/net/buildGuard.ts";

export default defineConfig(({ mode }) => {
  // process.env (CI) wins over .env files, matching Vite's own precedence.
  assertProdServerUrl({ ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env });
  return {
    base: "./",
    server: { host: true, port: 5173 },
    // three.js alone is ~500 kB minified (~150 kB gzip); well inside the 5 MB budget (§1.3).
    build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 800 },
  };
});
