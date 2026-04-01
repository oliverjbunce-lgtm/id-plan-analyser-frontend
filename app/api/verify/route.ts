import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-session-token") || req.cookies.get("ai_session")?.value;
  if (!token) return NextResponse.json({ error: "no session" }, { status: 401 });

  const sessionId = await verifySession(token);
  if (!sessionId) return NextResponse.json({ error: "invalid" }, { status: 401 });

  return NextResponse.json({ ok: true, sessionId });
}
