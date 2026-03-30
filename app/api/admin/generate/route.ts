import { NextRequest, NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (adminKey !== process.env.ADMIN_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { label } = await req.json();
  await initDb();

  const id = randomUUID();
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO ai_tokens (id, label) VALUES (?, ?)",
    args: [id, label || ""],
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ai.iddoors.co.nz";
  return NextResponse.json({ token: id, link: `${baseUrl}/join/${id}` });
}
