import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/lib/validation/setup.ts"],
    include: ["src/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
