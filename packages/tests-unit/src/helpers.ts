import { Readable, type Writable } from "node:stream";

/** Reads a web ReadableStream (or Node stream) to a string. */
export async function readAll(
  body: ReadableStream | NodeJS.ReadableStream | null | undefined,
): Promise<string> {
  if (!body) return "";
  const stream = "getReader" in body ? Readable.fromWeb(body as never) : (body as Readable);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A promise you resolve from the outside. */
export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function webStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      if (text) c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
}

/** Types the stream creator OpenNext passes to a handler (its declaration is not exported). */
export const asStreamCreator = (value: unknown) =>
  value as {
    writeHeaders: (prelude: {
      statusCode: number;
      headers: Record<string, string | string[]>;
      cookies: string[];
    }) => Writable;
  };
