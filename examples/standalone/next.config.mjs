import { withAzure } from "next-on-azure/config";

// withAzure() sets output, the cache handlers and the settings Azure needs (ADR-0017).
export default withAzure({
  experimental: { useCache: true },
});
