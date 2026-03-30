import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/join", "/api/join", "/api/admin", "/_next", "/favicon.ico"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Admin page — protected by ADMIN_KEY cookie check handled in the page itself
  if (pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  // Check session cookie
  const session = req.cookies.get("ai_session")?.value;
  if (!session) {
    return NextResponse.redirect(new URL("/join", req.url));
  }

  // Verify session exists in DB via internal API
  const verifyUrl = new URL("/api/verify", req.url);
  const verifyRes = await fetch(verifyUrl, {
    headers: { "x-session-id": session },
  });

  if (!verifyRes.ok) {
    const res = NextResponse.redirect(new URL("/join", req.url));
    res.cookies.delete("ai_session");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
