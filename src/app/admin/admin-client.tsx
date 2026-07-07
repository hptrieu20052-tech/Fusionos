"use client";
import { useEffect, useState } from "react";
import { IconKey, IconLock, IconLockOpen, IconTrash } from "@/components/icons";
import { useLang } from "@/components/lang-provider";

const MODULES = ["dashboard", "orders", "fulfillment", "designs", "finance", "hr", "stores", "settings"] as const;
const MODULE_KEY: Record<string, string> = { dashboard: "adm.modDashboard", orders: "adm.modOrders", fulfillment: "adm.modFulfillment", designs: "adm.modDesigns", finance: "adm.modFinance", hr: "adm.modHr", stores: "adm.modStores", settings: "adm.modSettings" };
const ROLES = ["admin", "seller", "designer", "support", "content", "hiring"] as const;
const LEVEL_KEY = ["adm.levelHide", "adm.levelView", "adm.levelFull"];
const LEVEL_STYLE = [
  { background: "#EEF0F5", color: "#9CA3AF" },
  { background: "var(--amber-soft)", color: "var(--amber)" },
  { background: "var(--green-soft)", color: "var(--green)" },
];

type Perm = { role: string; module: string; level: number };
type User = { id: string; fullName: string; email: string; role: string; team: string | null; status: string };

export function AdminClient({ users: initialUsers, permissions }: { users: User[]; permissions: Perm[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [perms, setPerms] = useState<Map<string, number>>(
    new Map(permissions.map((p) => [`${p.role}:${p.module}`, p.level]))
  );
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "seller", team: "" });
  const [msg, setMsg] = useState("");
  const { t } = useLang();

  function levelOf(role: string, module: string) {
    if (role === "admin") return 2;
    return perms.get(`${role}:${module}`) ?? 0;
  }

  async function cycle(role: string, module: string) {
    if (role === "admin") return;
    const next = (levelOf(role, module) + 2) % 3; // 2→1→0→2
    const res = await fetch("/api/admin/permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, module, level: next }),
    });
    if (res.ok) setPerms(new Map(perms).set(`${role}:${module}`, next));
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json();
    if (j.ok) {
      setUsers([...users, { id: j.id, fullName: form.fullName, email: form.email, role: form.role, team: form.team, status: "active" }]);
      setForm({ fullName: "", email: "", password: "", role: "seller", team: "" });
      setMsg(t("adm.accountCreated") + (form.role === "seller" ? t("adm.sellerAutoNote") : ""));
    } else setMsg("⚠ " + (j.error ?? "Error"));
  }

  const inp = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit" } as const;

  async function patchUser(id: string, body: Record<string, unknown>, okMsg?: string) {
    const j = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: id, ...body }) }).then((r) => r.json());
    if (j.ok) {
      setUsers((us) => us.map((u) => u.id === id ? { ...u, ...(body.role ? { role: body.role as string } : {}), ...(body.team !== undefined ? { team: (body.team as string) || null } : {}), ...(body.status ? { status: body.status as string } : {}) } : u));
      if (okMsg) setMsg(okMsg);
    } else setMsg("⚠ " + (j.error ?? "Error"));
  }
  async function resetPass(u: User) {
    const pw = prompt(t("adm.newPwPrompt").replace("{name}", u.fullName));
    if (!pw) return;
    if (pw.length < 6) return setMsg(t("adm.pwTooShort"));
    await patchUser(u.id, { password: pw }, `✓ Đã đặt lại mật khẩu cho ${u.fullName}`);
  }
  async function toggleStatus(u: User) {
    await patchUser(u.id, { status: u.status === "active" ? "disabled" : "active" }, `✓ ${u.status === "active" ? t("adm.didLock") : t("adm.didUnlock")} ${u.fullName}`);
  }
  async function deleteUser(u: User) {
    if (!confirm(t("adm.confirmDeleteUser").replace("{name}", u.fullName))) return;
    const j = await fetch("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: u.id }) }).then((r) => r.json());
    if (j.ok) { setUsers((us) => us.filter((x) => x.id !== u.id)); setMsg(`✓ Đã xóa ${u.fullName}`); }
    else setMsg("⚠ " + (j.error ?? "Error"));
  }
  const actBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer", marginLeft: 6, fontWeight: 600, color: "var(--ink)" };

  type Team = { id: string; name: string; members: { id: string; fullName: string; role: string }[] };
  const [teamList, setTeamList] = useState<Team[]>([]);
  const [newTeam, setNewTeam] = useState("");
  const loadTeams = () => fetch("/api/admin/teams").then((r) => r.json()).then((j) => { if (j.ok) setTeamList(j.teams); });
  useEffect(() => { loadTeams(); }, []);

  async function addTeam() {
    const name = newTeam.trim(); if (!name) return;
    const j = await fetch("/api/admin/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json());
    if (j.ok) { setNewTeam(""); loadTeams(); } else setMsg("⚠ " + (j.error ?? "Error"));
  }
  async function renameTeam(id: string, name: string, old: string) {
    if (!name.trim() || name === old) return;
    const j = await fetch("/api/admin/teams", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name: name.trim() }) }).then((r) => r.json());
    if (j.ok) { setUsers((us) => us.map((u) => u.team === old ? { ...u, team: name.trim() } : u)); loadTeams(); }
    else { setMsg("⚠ " + (j.error ?? "Error")); loadTeams(); }
  }
  async function deleteTeam(tm: Team) {
    if (!confirm(t("adm.confirmDeleteTeam").replace("{name}", tm.name).replace("{n}", String(tm.members.length)))) return;
    const j = await fetch("/api/admin/teams", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: tm.id }) }).then((r) => r.json());
    if (j.ok) { setUsers((us) => us.map((u) => u.team === tm.name ? { ...u, team: null } : u)); loadTeams(); }
    else setMsg("⚠ " + (j.error ?? "Error"));
  }
  async function setMemberTeam(userId: string, team: string) {
    await patchUser(userId, { team });
    loadTeams();
  }

  return (
    <>
      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>{t("adm.createStaff")}</h3>
        <form onSubmit={createUser} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <input required placeholder={t("adm.colName")} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} style={{ ...inp, flex: 1, minWidth: 150 }} />
          <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...inp, flex: 1, minWidth: 180 }} />
          <input required placeholder={t("adm.tempPw")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ ...inp, width: 140 }} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inp}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} style={{ ...inp, width: 150 }}>
            <option value="">— team —</option>
            {teamList.map((tm) => <option key={tm.id} value={tm.name}>{tm.name}</option>)}
          </select>
          <button style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 11, padding: "9px 18px", fontWeight: 800, cursor: "pointer" }}>{t("adm.create")}</button>
        </form>
        {msg && <div style={{ marginTop: 10, fontWeight: 700, fontSize: 12.5 }}>{msg}</div>}
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>{t("adm.staff")} · {users.length}</h3>
        <div className="sub" style={{ marginBottom: 8 }}>{t("adm.staffHint")}</div>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>{t("adm.colName")}</th><th>Email</th><th>{t("adm.colRole")}</th><th>Team</th><th>{t("adm.colStatus")}</th><th style={{ textAlign: "right" }}>{t("adm.colActions")}</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ opacity: u.status === "active" ? 1 : 0.55 }}>
                <td><b>{u.fullName}</b></td>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} onChange={(e) => patchUser(u.id, { role: e.target.value })} style={{ ...inp, padding: "5px 8px", fontSize: 12.5 }}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td>
                  <select value={u.team ?? ""} onChange={(e) => setMemberTeam(u.id, e.target.value)} style={{ ...inp, padding: "5px 8px", fontSize: 12.5, width: 150 }}>
                    <option value="">{t("adm.noTeamOpt")}</option>
                    {teamList.map((tm) => <option key={tm.id} value={tm.name}>{tm.name}</option>)}
                  </select>
                </td>
                <td style={{ color: u.status === "active" ? "var(--green)" : "var(--faint)", fontWeight: 700 }}>{u.status === "active" ? t("adm.active") : t("adm.locked")}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={() => resetPass(u)} style={actBtn} title={t("adm.resetPwTitle")}><IconKey width={13} height={13} /> {t("adm.reset")}</button>
                  <button onClick={() => toggleStatus(u)} style={{ ...actBtn, color: u.status === "active" ? "var(--amber)" : "var(--green)" }}>{u.status === "active" ? <><IconLock width={13} height={13} /> {t("adm.lock")}</> : <><IconLockOpen width={13} height={13} /> {t("adm.unlock")}</>}</button>
                  <button onClick={() => deleteUser(u)} style={{ ...actBtn, color: "var(--red)" }}><IconTrash width={13} height={13} /> {t("adm.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Quản lý Team */}
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>Team · {teamList.length}</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder={t("adm.newTeamPh")} value={newTeam} onChange={(e) => setNewTeam(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTeam()} style={{ ...inp, padding: "7px 11px", fontSize: 13 }} />
            <button onClick={addTeam} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "7px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{t("adm.addTeam")}</button>
          </div>
        </div>
        <div className="sub" style={{ margin: "8px 0 12px" }}>{t("adm.teamHint")}</div>

        {teamList.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("adm.noTeamsYet")}</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
            {teamList.map((tm) => {
              const outside = users.filter((u) => u.team !== tm.name);
              return (
                <div key={tm.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <input defaultValue={tm.name}
                      onBlur={(e) => renameTeam(tm.id, e.target.value, tm.name)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      style={{ ...inp, padding: "5px 8px", fontSize: 13.5, fontWeight: 700, flex: 1, minWidth: 0 }} />
                    <button onClick={() => deleteTeam(tm)} title={t("adm.deleteTeam")} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--red-soft)", color: "var(--red)", border: "1px solid #F3C6C0", borderRadius: 8, padding: "6px 8px", cursor: "pointer" }}><IconTrash width={14} height={14} /></button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
                    {tm.members.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("adm.noMembers")}</div>}
                    {tm.members.map((m) => (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5 }}>
                        <span>{m.fullName} <span style={{ color: "var(--muted)" }}>· {m.role}</span></span>
                        <button onClick={() => setMemberTeam(m.id, "")} title={t("adm.removeMember")} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                  <select value="" onChange={(e) => e.target.value && setMemberTeam(e.target.value, tm.name)} style={{ ...inp, padding: "6px 9px", fontSize: 12, width: "100%" }}>
                    <option value="">{t("adm.addMember")}</option>
                    {outside.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.role}){u.team ? ` · ${t("adm.inTeam")} ${u.team}` : ""}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>{t("adm.permMatrix")}</h3>
        <div className="sub" style={{ marginBottom: 10 }}>{t("adm.permHint")}</div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Module</th>{ROLES.map((r) => <th key={r} style={{ textAlign: "center" }}>{r}</th>)}</tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m}>
                  <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{t(MODULE_KEY[m])}</td>
                  {ROLES.map((r) => {
                    const lv = levelOf(r, m);
                    return (
                      <td key={r} style={{ textAlign: "center" }}>
                        <span
                          onClick={() => cycle(r, m)}
                          style={{
                            ...LEVEL_STYLE[lv],
                            display: "inline-block", minWidth: 78, padding: "5px 0", borderRadius: 8,
                            fontSize: 11.5, fontWeight: 800, cursor: r === "admin" ? "not-allowed" : "pointer",
                            opacity: r === "admin" ? 0.55 : 1, userSelect: "none",
                          }}
                        >
                          {t(LEVEL_KEY[lv])}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
