import { unstable_cache } from "next/cache";

export const dynamic = "force-dynamic";

const getValue = unstable_cache(async () => new Date().toISOString(), ["tagged-value"], {
  tags: ["demo-tag"],
});

// The value only changes after revalidateTag("demo-tag") (verifies the Table tag cache).
export default async function Page() {
  return <p id="v">value {await getValue()}</p>;
}
