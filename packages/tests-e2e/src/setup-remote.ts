import type { TestProject } from "vitest/node";

/** Tests a deployed app: `E2E_BASE_URL=https://<app>.azurewebsites.net pnpm e2e:remote`. */
export async function setup(project: TestProject) {
  const baseUrl = process.env.E2E_BASE_URL;
  if (!baseUrl?.startsWith("https://")) {
    throw new Error("E2E_BASE_URL must be set to the https URL of the deployed app");
  }
  project.provide("baseUrl", baseUrl);
  project.provide("runDir", "");
  project.provide("remote", true);
}
