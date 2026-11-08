import { Suspense } from "react";

export const dynamic = "force-dynamic";

async function Slow() {
  await new Promise((r) => setTimeout(r, 3000));
  return <p id="late">late content</p>;
}

// Streams the shell immediately and the slow part after 3 seconds (verifies streaming, B6).
export default function Page() {
  return (
    <main>
      <h1 id="early">early content</h1>
      <Suspense fallback={<p>loading</p>}>
        <Slow />
      </Suspense>
    </main>
  );
}
