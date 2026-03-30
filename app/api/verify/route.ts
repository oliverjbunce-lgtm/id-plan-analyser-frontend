import { NextRequest, NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.headers.get("x-session-id");
  if (!sessionId) return NextResponse.json({ error: "no session" }, { status: 401 });

  await initDb();
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT id FROM ai_sessions WHERE id = ?",
    args: [sessionId],
  });

  if (!result.rows[0]) return NextResponse.json({ error: "invalid" }, { status: 401 });
  return NextResponse.json({ ok: true });
}
