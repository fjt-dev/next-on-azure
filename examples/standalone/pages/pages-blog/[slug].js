// Pages Router with fallback: "blocking": only "known" is built; other slugs render on first request.
export function getStaticPaths() {
  return { paths: [{ params: { slug: "known" } }], fallback: "blocking" };
}

export function getStaticProps({ params }) {
  if (params.slug === "missing") return { notFound: true };
  return { props: { slug: params.slug, builtAt: new Date().toISOString() } };
}

export default function PagesBlog({ slug, builtAt }) {
  return (
    <main>
      <h1>Post {slug}</h1>
      <p id="built-at">{builtAt}</p>
    </main>
  );
}
