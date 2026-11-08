import type { Cookie } from "@azure/functions";

/**
 * Azure Functions accepts several cookies only as structured values (`HttpResponseInit.cookies`):
 * with several `Set-Cookie` headers the host keeps just the last one. The structured form is
 * validated by the platform, and one invalid attribute (an unknown `SameSite`, a date it cannot
 * read, a non-numeric `Max-Age`) fails the whole response, so such attributes are dropped here.
 *
 * Attributes the platform has no field for (`Partitioned`, `Priority`, extensions) are dropped too.
 */
export function parseSetCookie(line: string): Cookie | undefined {
  const [pair, ...attributes] = line.split(";");
  const eq = pair?.indexOf("=") ?? -1;
  if (!pair || eq < 1) return undefined;
  const name = pair.slice(0, eq).trim();
  if (!name) return undefined;
  const cookie: Cookie = { name, value: pair.slice(eq + 1).trim() };

  for (const raw of attributes) {
    const at = raw.indexOf("=");
    const key = (at === -1 ? raw : raw.slice(0, at)).trim().toLowerCase();
    const value = at === -1 ? "" : raw.slice(at + 1).trim();
    switch (key) {
      case "domain":
        if (value) cookie.domain = value;
        break;
      case "path":
        if (value) cookie.path = value;
        break;
      case "expires": {
        const time = Date.parse(value);
        if (!Number.isNaN(time)) cookie.expires = new Date(time);
        break;
      }
      case "max-age":
        if (/^-?\d+$/.test(value)) cookie.maxAge = Number(value);
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "samesite": {
        const v = value.toLowerCase();
        if (v === "strict") cookie.sameSite = "Strict";
        else if (v === "lax") cookie.sameSite = "Lax";
        else if (v === "none") cookie.sameSite = "None";
        break;
      }
    }
  }
  return cookie;
}

/** Removes the `Set-Cookie` entries from a header map and returns them as structured cookies. */
export function takeCookies(headers: Record<string, string | string[]>): Cookie[] {
  const cookies: Cookie[] = [];
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== "set-cookie") continue;
    for (const line of ([] as string[]).concat(headers[key] ?? [])) {
      const cookie = parseSetCookie(line);
      if (cookie) cookies.push(cookie);
    }
    delete headers[key];
  }
  return cookies;
}
