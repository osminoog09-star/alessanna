"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { QrPanel } from "@/components/QrPanel";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { user, loading, setSession } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "");
    const password = String(fd.get("password") || "");
    const r = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const j = (await r.json()) as {
      error?: string;
      accessToken?: string;
      user?: { id: number; email: string; role: string; employeeId: number | null };
    };
    if (r.ok && j.accessToken && j.user) {
      setSession(j.accessToken, j.user);
      router.replace("/");
    } else {
      window.alert(j.error || "Login failed");
    }
  }

  async function onAdminDirect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("adminEmail") || "");
    const phone = String(fd.get("adminPhone") || "");
    const r = await apiFetch("/api/auth/admin-direct", {
      method: "POST",
      body: JSON.stringify({ email, phone }),
    });
    const j = (await r.json()) as {
      error?: string;
      accessToken?: string;
      user?: { id: number; email: string; role: string; employeeId: number | null };
    };
    if (r.ok && j.accessToken && j.user) {
      setSession(j.accessToken, j.user);
      router.replace("/");
    } else {
      window.alert(j.error || "Admin login failed");
    }
  }

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (user) return null;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="sidebar__brand" style={{ padding: 0, marginBottom: "0.5rem" }}>
          AlesSanna · Work
        </div>
        <h1 style={{ marginTop: 0, fontSize: "1.25rem", fontWeight: 600 }}>Sign in</h1>
        <p className="muted">Scan the QR with your phone and confirm with your registered number. No public links here.</p>

        <details className="panel" style={{ marginTop: "1rem", marginBottom: "1rem" }}>
          <summary className="muted" style={{ cursor: "pointer", fontWeight: 500 }}>
            Admin · direct access
          </summary>
          <form onSubmit={onAdminDirect} style={{ marginTop: "0.75rem" }}>
            <div className="row">
              <label>
                <span>Email</span>
                <input name="adminEmail" type="email" required autoComplete="username" />
              </label>
              <label>
                <span>Phone</span>
                <input name="adminPhone" type="tel" required autoComplete="tel" placeholder="digits only" />
              </label>
            </div>
            <button type="submit" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
              Sign in as admin
            </button>
          </form>
        </details>

        <QrPanel />

        <details style={{ marginTop: "1.25rem" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            Emergency password login
          </summary>
          <form onSubmit={onPassword} className="panel" style={{ marginTop: "0.75rem" }}>
            <div className="row">
              <label>
                <span>Email</span>
                <input name="email" type="email" required autoComplete="username" />
              </label>
              <label>
                <span>Password</span>
                <input name="password" type="password" required autoComplete="current-password" />
              </label>
            </div>
            <button type="submit" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
              Sign in
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}
