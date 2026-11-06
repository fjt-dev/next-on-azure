export const revalidate = 60;
export async function generateStaticParams() {
  return [{ slug: "a" }];
}
export default async function P({ params }) {
  const { slug } = await params;
  return <h1>post {slug}</h1>;
}
