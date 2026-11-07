import { NextResponse } from "next/server";

// Runs for /mw/* only. Covers the three things middleware does: set a header, redirect, rewrite.
export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (pathname === "/mw/redirect") {
    return NextResponse.redirect(new URL("/pages-static", request.url), 307);
  }
  if (pathname === "/mw/rewrite") {
    const rewritten = NextResponse.rewrite(new URL("/pages-static", request.url));
    rewritten.headers.set("x-example-middleware", "rewrite");
    return rewritten;
  }
  const response = NextResponse.next();
  response.headers.set("x-example-middleware", "ran");
  return response;
}

export const config = { matcher: ["/mw/:path*"] };
