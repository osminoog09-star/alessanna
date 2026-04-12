"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type QrSessionResponse = {
  token?: string;
  scanBase?: string | null;
  telegramUrl?: string | null;
};

export function QrPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const router = useRouter();
  const { setSession } = useAuth();

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startSession = useCallback(async () => {
    stopPoll();
    setPhase("loading");
    setError(null);
    tokenRef.current = null;
    const res = await apiFetch("/api/auth/qr-session", { method: "POST" });
    const data = (await res.json()) as QrSessionResponse;
    if (!res.ok || !data.token) {
      setPhase("error");
      setError("Could not start QR session. Refresh the page.");
      return;
    }
    tokenRef.current = data.token;

    const scanUrl =
      data.telegramUrl ||
      (() => {
        const originBase =
          (data.scanBase && String(data.scanBase).replace(/\/$/, "")) ||
          (typeof window !== "undefined" ? window.location.origin : "");
        return `${originBase}/work/m/?token=${encodeURIComponent(data.token)}`;
      })();

    if (!data.telegramUrl && typeof window !== "undefined") {
      console.warn("[QrPanel] No telegramUrl — set TELEGRAM_BOT_USERNAME and TELEGRAM_BOT_TOKEN on the server.");
    }

    const canvas = canvasRef.current;
    if (canvas) {
      try {
        await QRCode.toCanvas(canvas, scanUrl, {
          width: 220,
          margin: 2,
          color: { dark: "#2d2d2a", light: "#ffffff" },
        });
      } catch {
        setError(scanUrl);
      }
    }
    setPhase("ready");

    pollRef.current = setInterval(async () => {
      const t = tokenRef.current;
      if (!t) return;
      const r = await apiFetch(`/api/auth/qr/status?token=${encodeURIComponent(t)}`);
      const j = (await r.json()) as {
        success?: boolean;
        error?: string;
        accessToken?: string;
        user?: { id: number; email: string; role: string; employeeId: number | null; name?: string };
      };
      if (j.success && j.user && j.accessToken) {
        stopPoll();
        setSession(j.accessToken, j.user);
        router.replace("/");
        return;
      }
      if (j.error === "expired") {
        stopPoll();
        void startSession();
      }
    }, 2000);
  }, [router, setSession, stopPoll]);

  useEffect(() => {
    void startSession();
    return () => stopPoll();
  }, [startSession, stopPoll]);

  return (
    <div className="qr-host">
      {phase === "loading" && <p className="muted">Generating QR code…</p>}
      <canvas ref={canvasRef} width={220} height={220} hidden={phase !== "ready"} />
      {phase === "ready" && (
        <p className="muted" style={{ textAlign: "center", maxWidth: "24rem" }}>
          Scan with your phone camera. Telegram opens — tap <strong>Start</strong>. This computer signs in within a few
          seconds. (If the server has no Telegram bot configured, the QR may open the legacy web confirm page instead.)
        </p>
      )}
      {error &&
        (error.startsWith("http") ? (
          <pre className="muted" style={{ fontSize: "0.75rem" }}>
            {error}
          </pre>
        ) : (
          <p className="error">{error}</p>
        ))}
    </div>
  );
}
