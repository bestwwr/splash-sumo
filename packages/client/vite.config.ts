import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { host: true, port: 5173 },
  // three.js alone is ~500 kB minified (~150 kB gzip); well inside the 5 MB budget (§1.3).
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 800 },
});
