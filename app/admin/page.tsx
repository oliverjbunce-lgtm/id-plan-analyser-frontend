"use client";

import { useState, useEffect } from "react";

interface Token {
  id: string;
  label: string;
  claimed: number;
  created_at: number;
}

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [label, setLabel] = useState("");
  const [newLink, setNewLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function login() {
    const res = await fetch("/api/admin/tokens", { headers: { "x-admin-key": key } });
    if (res.ok) {
      const data = await res.json();
      setTokens(data.tokens);
      setAuthed(true);
    } else {
      alert("Wrong key");
    }
  }

  async function generate() {
    setLoading(true);
    const res = await fetch("/api/admin/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    setNewLink(data.link);
    setLabel("");
    setLoading(false);
    refresh();
  }

  async function refresh() {
    const res = await fetch("/api/admin/tokens", { headers: { "x-admin-key": key } });
    const data = await res.json();
    setTokens(data.tokens);
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this access? The user will lose access immediately.")) return;
    await fetch("/api/admin/tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({ id }),
    });
    refresh();
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm">
          <div className="w-12 h-12 rounded-xl bg-[#0b1f33] flex items-center justify-center mb-6">
            <span className="text-[#F7C600] text-lg font-bold">ID</span>
          </div>
          <h1 className="text-xl font-bold mb-6">Admin Access</h1>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            placeholder="Admin key"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#0b1f33]"
          />
          <button onClick={login} className="w-full bg-[#0b1f33] text-white font-semibold py-3 rounded-xl text-sm hover:bg-[#162d47] transition-colors">
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#0b1f33] flex items-center justify-center">
            <span className="text-[#F7C600] text-sm font-bold">ID</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">AI Portal — Admin</h1>
            <p className="text-xs text-gray-400">Manage access to the floor plan analyser</p>
          </div>
        </div>

        {/* Generate new link */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <h2 className="font-semibold text-sm mb-4">Generate Invite Link</h2>
          <div className="flex gap-3">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && generate()}
              placeholder="Name or label (e.g. Paul Harris)"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1f33]"
            />
            <button
              onClick={generate}
              disabled={loading}
              className="bg-[#0b1f33] text-white font-semibold px-5 py-2.5 rounded-xl text-sm hover:bg-[#162d47] transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "Generate"}
            </button>
          </div>

          {newLink && (
            <div className="mt-4 bg-green-50 border border-green-100 rounded-xl p-4">
              <p className="text-xs text-green-600 font-medium mb-2">New invite link — send this once:</p>
              <div className="flex gap-2 items-center">
                <code className="text-xs text-gray-700 flex-1 break-all">{newLink}</code>
                <button
                  onClick={() => copy(newLink)}
                  className="bg-white border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Token list */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm">Access Links</h2>
            <button onClick={refresh} className="text-xs text-gray-400 hover:text-gray-600">Refresh</button>
          </div>

          {tokens.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No links generated yet</p>
          ) : (
            <div className="space-y-2">
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t.label || "Unnamed"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t.claimed ? "✅ Claimed" : "⏳ Pending"} · {new Date(t.created_at * 1000).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => revoke(t.id)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors px-3 py-1 rounded-lg hover:bg-red-50"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
