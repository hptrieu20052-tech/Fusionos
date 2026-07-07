"use client";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/components/lang-provider";
import { IconCopy } from "@/components/icons";

type Profile = {
  fullName: string; email: string; role: string; team: string | null;
  phone: string; gender: string; dateOfBirth: string; avatarUrl: string | null;
};

const inp: React.CSSProperties = { width: "100%", border: "1px solid var(--line)", borderRadius: 11, padding: "10px 12px", fontSize: 13.5, background: "#fff" };
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 6, display: "block" };
const btnPrimary: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: "none", borderRadius: 11, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" };

export default function AccountClient() {
  const { t } = useLang();
  const [p, setP] = useState<Profile | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2800); };

  useEffect(() => { fetch("/api/account").then((r) => r.json()).then((j) => { if (j.ok) setP(j.user); }); }, []);

  const set = (k: keyof Profile, v: string) => p && setP({ ...p, [k]: v });

  const onPickAvatar = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const tk = await fetch("/api/account/avatar-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      }).then((r) => r.json());
      if (!tk.ok) throw new Error(tk.error ?? "avatar-url error");
      const put = await fetch(tk.url, { method: tk.method ?? "PUT", headers: tk.headers ?? {}, body: file });
      if (!put.ok) throw new Error(`R2 ${put.status}`);
      setAvatarKey(tk.storageKey);
      flash(t("a.savedProfile"));
    } catch (e) { flash("✗ " + (e as Error).message); setPreview(null); }
    setUploading(false);
  };

  const saveProfile = async () => {
    if (!p) return;
    setSaving(true);
    const j = await fetch("/api/account", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: p.fullName, phone: p.phone, gender: p.gender, dateOfBirth: p.dateOfBirth, ...(avatarKey ? { avatarKey } : {}) }),
    }).then((r) => r.json());
    setSaving(false);
    if (j.ok) flash(t("a.savedProfile")); else flash("✗ " + (j.error ?? "Error"));
  };

  const changePassword = async () => {
    if (pw.next !== pw.confirm) return flash("✗ " + t("a.pwMismatch"));
    setPwBusy(true);
    const j = await fetch("/api/account/password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: pw.current, next: pw.next }),
    }).then((r) => r.json());
    setPwBusy(false);
    if (j.ok) { flash(t("a.changedPassword")); setPw({ current: "", next: "", confirm: "" }); }
    else flash("✗ " + (j.error ?? "Error"));
  };

  if (!p) return <div className="panel empty">…</div>;
  const avatarSrc = preview ?? p.avatarUrl;
  const initials = p.fullName.split(" ").map((w) => w[0]).slice(-2).join("").toUpperCase();

  return (
    <>
      {msg && <div style={{ position: "fixed", top: 16, right: 16, zIndex: 100, background: "#111827", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13.5 }}>{msg}</div>}

      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "6px 0 2px" }}>{t("a.myAccount")}</h2>

      {/* HỒ SƠ */}
      <div className="panel">
        <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 16 }}>{t("a.profile")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 22, alignItems: "start" }}>
          {/* Avatar */}
          <div style={{ textAlign: "center" }}>
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              style={{ width: 116, height: 116, borderRadius: 20, border: "1px dashed var(--line)", background: "#F1F4F9", cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
              {avatarSrc
                ? <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ fontSize: 30, fontWeight: 800, color: "var(--blue)" }}>{initials}</span>}
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickAvatar(f); e.target.value = ""; }} />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, cursor: "pointer" }} onClick={() => fileRef.current?.click()}>
              {uploading ? t("a.uploading") : t("a.uploadAvatar")}
            </div>
          </div>
          {/* Cột 1 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div><label style={lbl}>{t("a.fullName")}</label><input value={p.fullName} onChange={(e) => set("fullName", e.target.value)} style={inp} /></div>
            <div>
              <label style={lbl}>{t("a.gender")}</label>
              <select value={p.gender} onChange={(e) => set("gender", e.target.value)} style={inp}>
                <option value="">—</option>
                <option value="male">{t("a.male")}</option>
                <option value="female">{t("a.female")}</option>
                <option value="other">{t("a.other")}</option>
              </select>
            </div>
            <div>
              <label style={lbl}>{t("a.email")}</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={p.email} readOnly style={{ ...inp, background: "#EDEFF4", color: "var(--muted)" }} />
                <button className="icon-btn" title={t("d.copy")} onClick={() => { navigator.clipboard?.writeText(p.email); flash(t("d.copied")); }}><IconCopy width={13} height={13} /></button>
              </div>
            </div>
          </div>
          {/* Cột 2 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div><label style={lbl}>{t("a.phone")}</label><input value={p.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0xxxxxxxxx" style={inp} /></div>
            <div><label style={lbl}>{t("a.dob")}</label><input type="date" value={p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : ""} onChange={(e) => set("dateOfBirth", e.target.value)} style={inp} /></div>
            <div style={{ display: "flex", gap: 14 }}>
              <div style={{ flex: 1 }}><label style={lbl}>{t("a.role")}</label><input value={p.role} readOnly style={{ ...inp, background: "#EDEFF4", color: "var(--muted)" }} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>{t("a.team")}</label><input value={p.team ?? "—"} readOnly style={{ ...inp, background: "#EDEFF4", color: "var(--muted)" }} /></div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
          <button onClick={saveProfile} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? "…" : t("a.saveProfile")}</button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("a.emailNote")}</span>
        </div>
      </div>

      {/* ĐỔI MẬT KHẨU */}
      <div className="panel">
        <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 16 }}>{t("a.changePassword")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 420 }}>
            <div><label style={lbl}>{t("a.currentPassword")}</label><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} style={inp} /></div>
            <div><label style={lbl}>{t("a.newPassword")}</label><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} style={inp} /></div>
            <div><label style={lbl}>{t("a.confirmPassword")}</label><input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} style={{ ...inp, ...(pw.confirm && pw.confirm !== pw.next ? { borderColor: "var(--red)" } : {}) }} /></div>
            <button onClick={changePassword} disabled={pwBusy || !pw.current || !pw.next || !pw.confirm}
              style={{ ...btnPrimary, marginTop: 4, opacity: pwBusy || !pw.current || !pw.next || !pw.confirm ? 0.55 : 1 }}>
              {pwBusy ? "…" : t("a.changePassword")}
            </button>
          </div>
          <div style={{ background: "var(--blue-soft)", border: "1px solid #BFE0FF", borderRadius: 12, padding: "14px 16px", fontSize: 13, lineHeight: 1.7, color: "var(--ink)" }}>
            {t("a.pwRule")}
            <div style={{ marginTop: 8 }}>{t("a.pwExample")}: <b style={{ fontFamily: "ui-monospace,monospace" }}>Fusion1@#233</b></div>
          </div>
        </div>
      </div>
    </>
  );
}
