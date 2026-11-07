"use server";

import { revalidatePath } from "next/cache";

// Verifies Server Actions and revalidatePath (path tags in the Table tag cache).
export async function refresh() {
  revalidatePath("/actions/data");
}
