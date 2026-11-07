import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
    /** Directory with this run's certificate (cert.pem) and logs (app.log). */
    runDir: string;
    /** true when testing a deployed app (E2E_BASE_URL) instead of the local stack. */
    remote: boolean;
  }
}
