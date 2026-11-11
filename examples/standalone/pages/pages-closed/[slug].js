// Pages Router with fallback: false (the App Router counterpart is app/params-closed).
export function getStaticPaths() {
  return { paths: [{ params: { slug: "known" } }], fallback: false };
}

export function getStaticProps({ params }) {
  return { props: { slug: params.slug } };
}

export default function PagesClosed({ slug }) {
  return <h1>Closed {slug}</h1>;
}
