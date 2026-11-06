import type { HttpRequest } from "@azure/functions";
import type { InternalEvent, InternalResult } from "@opennextjs/aws/types/open-next";
import type { Converter } from "@opennextjs/aws/types/overrides";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Azure Functions HttpRequest (v4 model) <-> OpenNext InternalEvent/Result. */
const converter: Converter<InternalEvent, InternalResult> = {
  name: "azure-functions-http",

  async convertFrom(req: HttpRequest): Promise<InternalEvent> {
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Behind Front Door the public host arrives in x-forwarded-host.
    const host = headers["x-forwarded-host"] ?? headers.host ?? "localhost";
    const proto = headers["x-forwarded-proto"] ?? "https";
    const incoming = new URL(req.url);
    const url = new URL(`${proto}://${host}${incoming.pathname}${incoming.search}`);

    const query: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      query[key] = values.length > 1 ? values : (values[0] ?? "");
    }

    const body =
      req.method === "GET" || req.method === "HEAD"
        ? Buffer.alloc(0)
        : Buffer.from(await req.arrayBuffer());

    return {
      type: "core",
      method: req.method,
      rawPath: url.pathname,
      url: url.href,
      body,
      headers,
      remoteAddress:
        headers["x-azure-clientip"] ?? headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? "::1",
      query,
      cookies: parseCookies(headers.cookie),
    };
  },

  // The wrapper builds the HttpResponseInit itself because it streams.
  async convertTo(result: InternalResult) {
    return result;
  },
};

export default converter;
