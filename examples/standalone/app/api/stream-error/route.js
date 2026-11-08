export const dynamic = "force-dynamic";

// Sends "partial" and then fails, to see what a client gets when the error comes after the first byte.
export function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("partial"));
      await new Promise((r) => setTimeout(r, 200));
      controller.error(new Error("failed after the first byte"));
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain" } });
}
