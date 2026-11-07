// Pages Router: only changes after res.revalidate("/pages-ondemand") (see pages/api/revalidate-page.js).
export function getStaticProps() {
  return { props: { builtAt: new Date().toISOString() }, revalidate: 3600 };
}

export default function PagesOnDemand({ builtAt }) {
  return (
    <main>
      <h1>Pages on demand</h1>
      <p id="built-at">{builtAt}</p>
    </main>
  );
}
