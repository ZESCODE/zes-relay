import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{mjs,tsx}"],
    environmentOptions: {
      jsdom: { url: "http://127.0.0.1/" },
    },
    // The integration test spawns a real Python relay; give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
  },
});
