import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/room.test.ts"], environment: "node" } });
