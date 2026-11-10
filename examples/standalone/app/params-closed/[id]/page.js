// dynamicParams = false: only the paths of generateStaticParams exist. Known gap: next-on-azure answers 404
// for them too, because Next.js does not find the prerendered page in the cache handler and, with no fallback,
// does not render it (NoFallbackError). See docs/compatibility.md.
export const dynamicParams = false;
export async function generateStaticParams() {
  return [{ id: "a" }];
}
export default async function P({ params }) {
  const { id } = await params;
  return <h1>closed {id}</h1>;
}
