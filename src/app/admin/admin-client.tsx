"use client";
import { useEffect, useState } from "react";
import { Flash } from "@/components/flash";
import { useConfirm, usePrompt } from "@/components/confirm-provider";
import { IconKey, IconLock, IconLockOpen, IconTrash } from "@/components/icons";
import { useLang } from "@/components/lang-provider";
import { UserFunctionPermission } from "./user-function-permission";

const MODULES = ["dashboard", "orders", "fulfillment", "designs", "finance", "hr", "stores", "settings"] as const;
const MODULE_KEY: Record<string, string> = { dashboard: "adm.modDashboard", orders: "adm.modOrders", fulfillment: "adm.modFulfillment", designs: "adm.modDesigns", finance: "adm.modFinance", hr: "adm.modHr", stores: "adm.modStores", settings: "adm.modSettings" };
const ROLES = ["admin", "seller", "designer", "support", "content", "hiring"] as const;
const LEVEL_KEY = ["adm.levelHide", "adm.levelView", "adm.levelFull"];
const LEVEL_STYLE = [
  { background: "#EEF0F5", color: "#9CA3AF" },
  { background: "var(--amber-soft)", color: "var(--amber)" },
  { background: "var(--green-soft)", color: "var(--green)" },
];
const RESTRICTIONS = ["hide_profit", "own_orders_only", "own_designs_only", "hide_customer_info"] as const;
const restrLabel = (t: (k: string) => string): Record<string, string> => ({
  hide_profit: t("adm.hideProfit"),
  own_orders_only: t("adm.viewOwnOrders"),
  own_designs_only: t("adm.viewOwnDesigns"),
  hide_customer_info: t("adm.hideCustomer"),
});

type Perm = { role: string; module: string; level: number };
type RoleRestr = { role: string; restrictionKey: string; enabled: boolean };
type DataScope = { role: string; resource: string; scope: string };
type Action = { key: string; module: string; label: string };
type RoleAction = { role: string; actionKey: string; enabled: boolean };
const scopeResources = (t: (k: string) => string): { key: string; label: string }[] => [{ key: "orders", label: t("adm.ordersWord") }, { key: "designs", label: "Design" }];
const scopeOpts = (t: (k: string) => string): { v: string; label: string }[] => [{ v: "all", label: t("adm.allWord") }, { v: "team", label: t("adm.wholeTeam") }, { v: "own", label: t("adm.ownOnly") }];
const ACTION_MODULE_LABEL: Record<string, string> = { orders: "Orders", designs: "Design Studio", fulfillment: "Fulfillment", stores: "Stores", finance: "Finance" };
type User = { id: string; fullName: string; email: string; role: string; team: string | null; status: string; avatarUrl?: string | null };

// Ô sửa trực tiếp (Full name / Email): trông như text, click là gõ được, Enter/blur để lưu, Esc để huỷ.
function EditableCell({ value, onSave, bold, type = "text" }: { value: string; onSave: (v: string) => void; bold?: boolean; type?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <input
      value={v} type={type} autoComplete="off"
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setV(value); (e.target as HTMLInputElement).blur(); }
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--blue)"; e.currentTarget.style.background = "#fff"; }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent";
        const nv = v.trim();
        if (nv && nv !== value) onSave(nv); else setV(value);
      }}
      style={{ width: "100%", boxSizing: "border-box", border: "1px solid transparent", borderRadius: 7, padding: "5px 7px", font: "inherit", fontWeight: bold ? 700 : 400, background: "transparent", cursor: "text" }}
      title="Click to edit"
    />
  );
}

export function AdminClient({ users: initialUsers, permissions, roleRestrictions, dataScopes, actions, roleActions }: { users: User[]; permissions: Perm[]; roleRestrictions: RoleRestr[]; dataScopes: DataScope[]; actions: Action[]; roleActions: RoleAction[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [perms, setPerms] = useState<Map<string, number>>(
    new Map(permissions.map((p) => [`${p.role}:${p.module}`, p.level]))
  );
  const [restr, setRestr] = useState<Set<string>>(
    new Set(roleRestrictions.filter((r) => r.enabled).map((r) => `${r.role}:${r.restrictionKey}`))
  );
  const [scopes, setScopes] = useState<Map<string, string>>(
    new Map(dataScopes.map((s) => [`${s.role}:${s.resource}`, s.scope]))
  );
  // Hành động BỊ TẮT (không có bản ghi = cho phép)
  const [denied, setDenied] = useState<Set<string>>(
    new Set(roleActions.filter((a) => !a.enabled).map((a) => `${a.role}:${a.actionKey}`))
  );
  const [actRole, setActRole] = useState("seller");
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "seller", team: "" });
  const [msg, setMsg] = useState("");
  const { t } = useLang();
  const confirm = useConfirm();
  const askPassword = usePrompt();

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

  async function toggleRestr(role: string, restriction: string) {
    if (role === "admin") return;
    const k = `${role}:${restriction}`;
    const enabled = !restr.has(k);
    const res = await fetch("/api/admin/permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, restriction, enabled }),
    });
    if (res.ok) { const n = new Set(restr); enabled ? n.add(k) : n.delete(k); setRestr(n); }
  }

  async function setScope(role: string, resource: string, scope: string) {
    if (role === "admin") return;
    const res = await fetch("/api/admin/permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, resource, scope }),
    });
    if (res.ok) setScopes(new Map(scopes).set(`${role}:${resource}`, scope));
  }

  // Tick hành động (checked = cho phép). Lưu enabled; bỏ tick → enabled=false (denied).
  async function toggleAction(role: string, action: string) {
    if (role === "admin") return;
    const k = `${role}:${action}`;
    const nowAllowed = !denied.has(k);   // đang cho phép → sẽ tắt
    const enabled = !nowAllowed;
    const res = await fetch("/api/admin/permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, action, enabled }),
    });
    if (res.ok) { const n = new Set(denied); enabled ? n.delete(k) : n.add(k); setDenied(n); }
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
      setUsers((us) => us.map((u) => u.id === id ? { ...u, ...(body.role ? { role: body.role as string } : {}), ...(body.team !== undefined ? { team: (body.team as string) || null } : {}), ...(body.status ? { status: body.status as string } : {}), ...(body.fullName ? { fullName: body.fullName as string } : {}), ...(body.email ? { email: body.email as string } : {}) } : u));
      if (okMsg) setMsg(okMsg);
    } else setMsg("⚠ " + (j.error ?? "Error"));
  }
  async function resetPass(u: User) {
    const pw = await askPassword({
      title: t("adm.resetPassword"),
      message: t("adm.newPwFor").replace("{name}", u.fullName),
      confirmText: t("adm.resetWord"),
      input: { type: "password", placeholder: t("adm.newPassword"), minLength: 6 },
    });
    if (!pw) return;
    await patchUser(u.id, { password: pw }, t("adm.pwResetFor").replace("{name}", u.fullName));
  }
  async function toggleStatus(u: User) {
    await patchUser(u.id, { status: u.status === "active" ? "disabled" : "active" }, `✓ ${u.status === "active" ? t("adm.didLock") : t("adm.didUnlock")} ${u.fullName}`);
  }
  async function deleteUser(u: User) {
    if (!(await confirm({ message: t("adm.confirmDeleteUser").replace("{name}", u.fullName), danger: true }))) return;
    const j = await fetch("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: u.id }) }).then((r) => r.json());
    if (j.ok) { setUsers((us) => us.filter((x) => x.id !== u.id)); setMsg(t("adm.deletedUser").replace("{name}", u.fullName)); }
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
    if (!(await confirm({ message: t("adm.confirmDeleteTeam").replace("{name}", tm.name).replace("{n}", String(tm.members.length)), danger: true }))) return;
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
        <Flash msg={msg} />
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>{t("adm.staff")} · {users.length}</h3>
        <div className="sub" style={{ marginBottom: 8 }}>{t("adm.staffHint")}</div>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th style={{ width: 44 }}></th><th>{t("adm.colName")}</th><th>Email</th><th>{t("adm.colRole")}</th><th>Team</th><th>{t("adm.colStatus")}</th><th style={{ textAlign: "right" }}>{t("adm.colActions")}</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ opacity: u.status === "active" ? 1 : 0.55 }}>
                <td>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", background: "var(--blue-soft)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12.5 }}>
                    {u.avatarUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={u.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : u.fullName.trim().split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase()}
                  </div>
                </td>
                <td><EditableCell value={u.fullName} bold onSave={(v) => patchUser(u.id, { fullName: v }, `✓ Updated name → ${v}`)} /></td>
                <td><EditableCell value={u.email} type="email" onSave={(v) => patchUser(u.id, { email: v }, `✓ Updated email → ${v}`)} /></td>
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

      <UserFunctionPermission />
    </>
  );
}
