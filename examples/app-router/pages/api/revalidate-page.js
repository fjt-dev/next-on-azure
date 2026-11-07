export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  await res.revalidate("/pages-ondemand");
  return res.json({ revalidated: true });
}
