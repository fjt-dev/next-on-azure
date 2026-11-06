import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
    /** Directory with this run's certificate (cert.pem) and logs (app.log). */
    runDir: string;
  }
}
