import { NextRequest, NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "no token" }, { status: 400 });

  await initDb();
  const db = getDb();

  const result = await db.execute({
    sql: "SELECT * FROM ai_tokens WHERE id = ?",
    args: [token],
  });

  const row = result.rows[0];
  if (!row) return NextResponse.json({ error: "invalid" }, { status: 404 });
  if (row.claimed) return NextResponse.json({ error: "already_used" }, { status: 409 });

  // Claim the token and create a session
  const sessionId = randomUUID();
  await db.batch([
    { sql: "UPDATE ai_tokens SET claimed = 1, session_id = ? WHERE id = ?", args: [sessionId, token] },
    { sql: "INSERT INTO ai_sessions (id, token_id) VALUES (?, ?)", args: [sessionId, token] },
  ], "write");

  const res = NextResponse.json({ ok: true });
  // Set long-lived session cookie (1 year)
  res.cookies.set("ai_session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
