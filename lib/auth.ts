// Edge-compatible JWT auth using Web Crypto API
const SECRET = process.env.SESSION_SECRET || "ai-portal-secret-2026";

async function getKey(secret: string) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSession(sessionId: string): Promise<string> {
  const key = await getKey(SECRET);
  const payload = JSON.stringify({ sid: sessionId, iat: Date.now() });
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${btoa(payload)}.${sigB64}`;
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;
    const key = await getKey(SECRET);
    const payload = atob(payloadB64);
    const enc = new TextEncoder();
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payload));
    if (!valid) return null;
    const { sid } = JSON.parse(payload);
    return sid as string;
  } catch {
    return null;
  }
}
