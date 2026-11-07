import { createRequire } from "node:module";

const nextMajor = Number(createRequire(import.meta.url)("next/package.json").version.split(".")[0]);

// `'use cache'` (Composable Caching) is behind a flag in Next.js 15 and 16.
export default {
  experimental: { useCache: true },
  images: {
    // The E2E suite serves a remote test image from this origin (see image.test.ts).
    remotePatterns: [{ protocol: "https", hostname: "localhost", port: "8443", pathname: "/**" }],
    // Next.js 16 refuses remote images whose host resolves to a private address (SSRF guard), and
    // Next.js 15 does not know the option. The test image comes from localhost, so only the example
    // allows it, and only on 16. Do not copy this into a real app.
    ...(nextMajor >= 16 ? { dangerouslyAllowLocalIP: true } : {}),
  },
};
