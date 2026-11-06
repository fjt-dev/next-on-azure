import { defineConfig } from "vitest/config";

// Run the projects one after the other (`pnpm e2e:test` does): both need the fixed local ports.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "default",
          include: ["src/default/**/*.test.ts"],
          globalSetup: ["src/setup-default.ts"],
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
      {
        // The same stack started with FRONT_DOOR_ID set.
        test: {
          name: "front-door",
          include: ["src/front-door/**/*.test.ts"],
          globalSetup: ["src/setup-front-door.ts"],
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
