import { revalidateTag } from "next/cache";

export async function POST() {
  revalidateTag("demo-tag");
  return Response.json({ revalidated: true });
}
