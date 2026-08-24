import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/shared/test/**/*.test.ts",
      "apps/market-server/test/**/*.test.ts",
      "apps/web/test/**/*.test.ts",
    ],
    testTimeout: 5000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "@traderkomak/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
    },
  },
});
