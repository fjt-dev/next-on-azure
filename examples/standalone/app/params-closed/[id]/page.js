// dynamicParams = false: only the paths of generateStaticParams exist. Next.js does not render such a page
// when it is not in the cache, so the page that `next build` made must be found in the cache (the cache
// handler reads it from the build output). `revalidate` makes the regeneration after it visible.
export const dynamicParams = false;
export const revalidate = 5;
export async function generateStaticParams() {
  return [{ id: "a" }];
}
export default async function P({ params }) {
  const { id } = await params;
  return (
    <main>
      <h1>closed {id}</h1>
      <p id="built-at">{new Date().toISOString()}</p>
    </main>
  );
}
