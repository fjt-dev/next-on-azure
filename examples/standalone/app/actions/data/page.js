// Prerendered at build time; the value only changes after revalidatePath("/actions/data").
export const dynamic = "force-static";

export default function Page() {
  return <p id="v">value {new Date().toISOString()}</p>;
}
