// `'use cache'` (Composable Caching) is behind a flag in Next.js 15 and 16.
export default {
  experimental: { useCache: true },
  images: {
    // The E2E suite serves a remote test image from this origin (see image.test.ts).
    remotePatterns: [{ protocol: "https", hostname: "localhost", port: "8443", pathname: "/**" }],
  },
};
