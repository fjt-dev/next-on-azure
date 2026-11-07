import * as cache from "next/cache";

// cacheTag / cacheLife are unstable_-prefixed in Next.js 15 and stable in 16.
const cacheTag = cache.cacheTag ?? cache.unstable_cacheTag;
const cacheLife = cache.cacheLife ?? cache.unstable_cacheLife;

async function getValue() {
  "use cache";
  cacheTag("use-cache-demo");
  cacheLife("hours");
  return new Date().toISOString();
}

// The value stays until revalidateTag("use-cache-demo") (see app/api/revalidate-use-cache).
export default async function Page() {
  return <p id="v">value {await getValue()}</p>;
}
