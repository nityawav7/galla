import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
          environment: "node",
          // Unit tests never touch real infrastructure.
          env: { SKIP_ENV_VALIDATION: "1", LOG_LEVEL: "silent" },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/load-env.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/server/db/schema/**"],
      reporter: ["text", "html", "json-summary"],
      // SPEC §7.6: domain 100%, services ≥ 85%.
      thresholds: {
        "src/server/domain/**": { 100: true },
        "src/server/services/**": { lines: 85, functions: 85, branches: 85, statements: 85 },
      },
    },
  },
});
