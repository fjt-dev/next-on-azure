import type { TestProject } from "vitest/node";

/** Tests a deployed app: `E2E_BASE_URL=https://<app>.azurewebsites.net pnpm e2e:remote`. */
export async function setup(project: TestProject) {
  const baseUrl = process.env.E2E_BASE_URL;
  // Plain http only for loopback (an app started on this machine, such as the standalone spike).
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(baseUrl ?? "");
  if (!baseUrl || (!baseUrl.startsWith("https://") && !loopback)) {
    throw new Error(
      "E2E_BASE_URL must be the https URL of the deployed app (http only for localhost)",
    );
  }
  project.provide("baseUrl", baseUrl);
  project.provide("runDir", "");
  project.provide("remote", true);
}
