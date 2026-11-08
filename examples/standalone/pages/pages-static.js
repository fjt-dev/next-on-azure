// Pages Router, generated at build time.
export function getStaticProps() {
  return { props: { builtAt: new Date().toISOString() } };
}

export default function PagesStatic({ builtAt }) {
  return (
    <main>
      <h1>Pages static</h1>
      <p id="built-at">{builtAt}</p>
    </main>
  );
}
