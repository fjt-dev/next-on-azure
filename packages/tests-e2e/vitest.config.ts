import { defineConfig } from "vitest/config";

// The HTTP suite runs against a deployed or locally started app (E2E_BASE_URL); see
// scripts/e2e-standalone.mjs. ISR waits are long enough for a slow platform.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "remote",
          include: ["src/default/**/*.test.ts"],
          globalSetup: ["src/setup-remote.ts"],
          testTimeout: 180_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
