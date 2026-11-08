import { revalidateTag } from "next/cache";

export async function POST() {
  // Next.js 16 asks for a cache profile as the second argument; 15 ignores it.
  revalidateTag("use-cache-demo", "max");
  return Response.json({ revalidated: true });
}
