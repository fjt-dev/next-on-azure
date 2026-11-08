// Pages Router API route.
export default function handler(req, res) {
  res.status(200).json({ method: req.method, hello: "pages-api" });
}
