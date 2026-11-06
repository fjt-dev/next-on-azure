import { after } from "next/server";

export const dynamic = "force-dynamic";

// Responds at once and schedules deferred work of 20 s, 90 s and 240 s. Each callback logs how long
// after the handler it really ran. If the platform stops the process after the response, the long
// ones are missing or late. Used for the waitUntil measurement on Azure (ADR-0006).
export async function GET() {
  const started = Date.now();
  for (const seconds of [20, 90, 240]) {
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      console.log(
        `AFTER_LONG ${seconds}s callback ran ${Date.now() - started}ms after the handler`,
      );
    });
  }
  return Response.json({ responded: true, scheduled: [20, 90, 240] });
}
