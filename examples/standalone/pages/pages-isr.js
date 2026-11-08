// Pages Router ISR: stale after 5 seconds, regenerated through the revalidation queue.
export function getStaticProps() {
  return { props: { builtAt: new Date().toISOString() }, revalidate: 5 };
}

export default function PagesIsr({ builtAt }) {
  return (
    <main>
      <h1>Pages ISR</h1>
      <p id="built-at">{builtAt}</p>
    </main>
  );
}
