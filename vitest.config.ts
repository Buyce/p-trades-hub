import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Standalone test config: the scanner modules under test are pure TypeScript
 * with no browser or framework dependency, so the app's Vite plugin stack is
 * deliberately not loaded here.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
