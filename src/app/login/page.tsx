"use client";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@fusion.co");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      const next = new URLSearchParams(location.search).get("next") ?? "/";
      location.href = next;
    } else {
      setErr("Sai email hoặc mật khẩu");
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: "60px auto" }}>
      <div className="panel" style={{ padding: "26px 28px" }}>
        <h1 style={{ fontSize: 18 }}>Đăng nhập FUSION OS</h1>
        <div className="sub" style={{ marginBottom: 16 }}>Tài khoản do Admin cấp</div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required
            style={{ padding: "11px 13px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit" }} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu" type="password" required
            style={{ padding: "11px 13px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit" }} />
          {err && <div style={{ color: "var(--red)", fontWeight: 700, fontSize: 12.5 }}>{err}</div>}
          <button disabled={busy}
            style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 11, padding: "12px", fontWeight: 800, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
        <div className="sub" style={{ marginTop: 14 }}>Dev: admin@fusion.co / tri@fusion.co / anh@fusion.co · mật khẩu <b>fusion123</b></div>
      </div>
    </div>
  );
}
