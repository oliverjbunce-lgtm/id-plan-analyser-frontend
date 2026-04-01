import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "./lib/auth";

const PUBLIC_PATHS = ["/join", "/api/join", "/api/admin", "/api/verify", "/_next", "/favicon.ico"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Demo mode — bypass all auth
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Admin page — handled by the page itself
  if (pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  // Verify JWT session cookie — no network call needed
  const token = req.cookies.get("ai_session")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/join", req.url));
  }

  const sessionId = await verifySession(token);
  if (!sessionId) {
    const res = NextResponse.redirect(new URL("/join", req.url));
    res.cookies.delete("ai_session");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
