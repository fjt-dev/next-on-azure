// Pages Router, server-side rendered on every request.
export function getServerSideProps({ query }) {
  return { props: { renderedAt: new Date().toISOString(), name: query.name ?? "world" } };
}

export default function PagesSsr({ renderedAt, name }) {
  return (
    <main>
      <h1>Pages SSR</h1>
      <p id="greeting">Hello {name}</p>
      <p id="rendered-at">{renderedAt}</p>
    </main>
  );
}
