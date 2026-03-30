import { NextRequest, NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== process.env.ADMIN_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await initDb();
  const db = getDb();
  const result = await db.execute("SELECT id, label, claimed, created_at FROM ai_tokens ORDER BY created_at DESC");
  return NextResponse.json({ tokens: result.rows });
}

export async function DELETE(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== process.env.ADMIN_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await req.json();
  const db = getDb();
  await db.execute({ sql: "DELETE FROM ai_tokens WHERE id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM ai_sessions WHERE token_id = ?", args: [id] });
  return NextResponse.json({ ok: true });
}
