"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "used">("loading");

  useEffect(() => {
    async function claim() {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        setStatus("success");
        setTimeout(() => router.replace("/"), 1500);
      } else if (res.status === 409) {
        setStatus("used");
      } else {
        setStatus("error");
      }
    }
    claim();
  }, [token, router]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-2xl bg-[#0b1f33] flex items-center justify-center mx-auto mb-6">
          <span className="text-[#F7C600] text-2xl font-bold">ID</span>
        </div>
        {status === "loading" && (
          <>
            <div className="w-6 h-6 border-2 border-[#0b1f33] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500 text-sm">Setting up your access...</p>
          </>
        )}
        {status === "success" && (
          <>
            <p className="text-2xl mb-2">✅</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">You're in</h2>
            <p className="text-gray-500 text-sm">Access granted. Redirecting you now...</p>
          </>
        )}
        {status === "used" && (
          <>
            <p className="text-2xl mb-2">🔒</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Link already used</h2>
            <p className="text-gray-500 text-sm">This invite link has already been claimed. Contact Independent Doors to request a new one.</p>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-2xl mb-2">⚠️</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid link</h2>
            <p className="text-gray-500 text-sm">This link isn't valid. Contact Independent Doors to get access.</p>
          </>
        )}
      </div>
    </div>
  );
}
