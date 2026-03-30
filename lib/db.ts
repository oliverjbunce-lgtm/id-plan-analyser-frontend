import { createClient } from "@libsql/client/http";

let _client: ReturnType<typeof createClient> | null = null;

export function getDb() {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

export async function initDb() {
  const db = getDb();
  await db.batch([
    `CREATE TABLE IF NOT EXISTS ai_tokens (
      id TEXT PRIMARY KEY,
      label TEXT,
      claimed INTEGER DEFAULT 0,
      session_id TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS ai_sessions (
      id TEXT PRIMARY KEY,
      token_id TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
  ], "write");
}
