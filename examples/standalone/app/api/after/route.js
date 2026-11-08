import { after } from "next/server";

export const dynamic = "force-dynamic";

// Responds immediately and does 2 seconds of deferred work afterwards (verifies waitUntil, B7).
export async function GET() {
  const started = Date.now();
  after(async () => {
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`AFTER_DONE ${Date.now() - started}ms after the handler ran`);
  });
  return Response.json({ responded: true });
}
