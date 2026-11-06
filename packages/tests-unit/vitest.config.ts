import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Real Azure SDKs against Azurite; see src/integration/global-setup.ts.
        test: {
          name: "integration",
          include: ["src/integration/**/*.test.ts"],
          globalSetup: ["src/integration/global-setup.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
