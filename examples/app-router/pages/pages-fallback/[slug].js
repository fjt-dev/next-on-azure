import { useRouter } from "next/router";

// Pages Router with fallback: true: an unknown slug first gets a "loading" shell; the page data is
// generated when the client asks for it (/_next/data/...), and later requests get the full page.
export function getStaticPaths() {
  return { paths: [{ params: { slug: "known" } }], fallback: true };
}

export function getStaticProps({ params }) {
  if (params.slug === "missing") return { notFound: true };
  return { props: { slug: params.slug, builtAt: new Date().toISOString() } };
}

export default function PagesFallback({ slug, builtAt }) {
  const router = useRouter();
  if (router.isFallback) {
    return (
      <main>
        <h1 id="loading">Loading</h1>
      </main>
    );
  }
  return (
    <main>
      <h1>Fallback post {slug}</h1>
      <p id="built-at">{builtAt}</p>
    </main>
  );
}
