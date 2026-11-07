// Sets several cookies, one of them with attributes that Azure Functions' own cookie parser rejects.
export async function GET(request) {
  const validOnly = new URL(request.url).searchParams.has("valid");
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", "a=1; Path=/; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "b=2; Path=/; Secure; Max-Age=60");
  if (!validOnly) {
    headers.append("set-cookie", "c=3; Path=/; SameSite=Bogus");
    headers.append("set-cookie", "d=4; Path=/; Expires=not-a-date");
    headers.append("set-cookie", "e=5; Path=/; Max-Age=soon");
  }
  return new Response(JSON.stringify({ ok: true }), { headers });
}
