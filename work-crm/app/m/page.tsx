"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

type ConfirmPhase = "form" | "loading" | "done" | "err";

function ConfirmContent() {
  const params = useSearchParams();
  const token = params.get("token");
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<ConfirmPhase>("form");
  const [message, setMessage] = useState("");

  const submit = useCallback(async () => {
    if (!token) return;
    setPhase("loading");
    setMessage("");
    try {
      const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
      const r = await fetch(`${base}/api/auth/qr/verify-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phone }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) {
        setPhase("form");
        setMessage(j.error || "Could not verify");
        return;
      }
      setPhase("done");
      setMessage("Confirmed. You can set the phone aside — the desktop will sign in shortly.");
    } catch {
      setPhase("form");
      setMessage("Network error.");
    }
  }, [token, phone]);

  if (!token) {
    return <p className="error">Missing session token. Open the link from the desktop QR code.</p>;
  }

  return (
    <div style={{ maxWidth: "22rem", margin: "0 auto", padding: "1.25rem" }}>
      <p
        style={{
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#6f6f6b",
          margin: "0 0 0.5rem",
        }}
      >
        AlesSanna · Work
      </p>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Confirm sign-in</h1>
      <p style={{ color: "#6f6f6b", fontSize: "13px", lineHeight: 1.55, margin: "0 0 1.25rem" }}>
        Enter the phone number registered for your staff profile (same format as in CRM). Admins: use the configured
        admin phone.
      </p>
      {phase === "form" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="panel"
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#6f6f6b" }}>
            Phone
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoComplete="tel"
              placeholder="+372 …"
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)" }}
            />
          </label>
          {message && <p className="error" style={{ marginTop: "0.75rem" }}>{message}</p>}
          <button type="submit" className="btn btn--primary" style={{ marginTop: "1rem", width: "100%" }}>
            Confirm
          </button>
        </form>
      )}
      {phase === "loading" && <p className="muted">Checking…</p>}
      {phase === "done" && <p style={{ fontWeight: 500 }}>{message}</p>}
    </div>
  );
}

export default function MobileConfirmPage() {
  return (
    <Suspense fallback={<p className="page-loading">Loading…</p>}>
      <ConfirmContent />
    </Suspense>
  );
}
