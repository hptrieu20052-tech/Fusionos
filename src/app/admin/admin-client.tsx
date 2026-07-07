"use client";
import { useState } from "react";

const MODULES = ["dashboard", "orders", "fulfillment", "designs", "finance", "hr", "stores", "settings"] as const;
const MODULE_VI: Record<string, string> = {
  dashboard: "Dashboard", orders: "Đơn hàng", fulfillment: "Fulfillment", designs: "Design Studio",
  finance: "Tài chính", hr: "Nhân sự", stores: "Store", settings: "Cài đặt",
};
const ROLES = ["admin", "seller", "designer", "support", "content", "hiring"] as const;
const LEVEL_TXT = ["Ẩn", "Chỉ xem", "Toàn quyền"];
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
      setMsg("Đã tạo tài khoản" + (form.role === "seller" ? " (seller tự động bật: chỉ xem đơn của mình, ẩn lợi nhuận)" : ""));
    } else setMsg("⚠ " + (j.error ?? "Lỗi"));
  }

  const inp = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit" } as const;

  async function patchUser(id: string, body: Record<string, unknown>, okMsg?: string) {
    const j = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: id, ...body }) }).then((r) => r.json());
    if (j.ok) {
      setUsers((us) => us.map((u) => u.id === id ? { ...u, ...(body.role ? { role: body.role as string } : {}), ...(body.team !== undefined ? { team: (body.team as string) || null } : {}), ...(body.status ? { status: body.status as string } : {}) } : u));
      if (okMsg) setMsg(okMsg);
    } else setMsg("⚠ " + (j.error ?? "Lỗi"));
  }
  async function resetPass(u: User) {
    const pw = prompt(`Mật khẩu mới cho ${u.fullName} (≥6 ký tự):`);
    if (!pw) return;
    if (pw.length < 6) return setMsg("⚠ Mật khẩu quá ngắn");
    await patchUser(u.id, { password: pw }, `✓ Đã đặt lại mật khẩu cho ${u.fullName}`);
  }
  async function toggleStatus(u: User) {
    await patchUser(u.id, { status: u.status === "active" ? "disabled" : "active" }, `✓ ${u.status === "active" ? "Đã khóa" : "Đã mở khóa"} ${u.fullName}`);
  }
  async function deleteUser(u: User) {
    if (!confirm(`Xóa hẳn tài khoản "${u.fullName}"? Nếu user đã gắn với design/đơn thì nên KHÓA thay vì xóa.`)) return;
    const j = await fetch("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: u.id }) }).then((r) => r.json());
    if (j.ok) { setUsers((us) => us.filter((x) => x.id !== u.id)); setMsg(`✓ Đã xóa ${u.fullName}`); }
    else setMsg("⚠ " + (j.error ?? "Lỗi"));
  }
  const teams = Array.from(new Set(users.map((u) => u.team).filter(Boolean))) as string[];
  const actBtn: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 9px", fontSize: 12, cursor: "pointer", marginLeft: 6, fontWeight: 600, color: "var(--ink)" };

  return (
    <>
      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Tạo tài khoản nhân viên</h3>
        <form onSubmit={createUser} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <input required placeholder="Họ tên" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} style={{ ...inp, flex: 1, minWidth: 150 }} />
          <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...inp, flex: 1, minWidth: 180 }} />
          <input required placeholder="Mật khẩu tạm" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ ...inp, width: 140 }} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inp}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input placeholder="Team" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} style={{ ...inp, width: 150 }} />
          <button style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 11, padding: "9px 18px", fontWeight: 800, cursor: "pointer" }}>＋ Tạo</button>
        </form>
        {msg && <div style={{ marginTop: 10, fontWeight: 700, fontSize: 12.5 }}>{msg}</div>}
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Nhân viên · {users.length}</h3>
        <div className="sub" style={{ marginBottom: 8 }}>Sửa Vai trò / Team ngay tại dòng. Gõ tên team để gán nhân viên vào team (thành viên cùng team mới thấy design của team).</div>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Team</th><th>Trạng thái</th><th style={{ textAlign: "right" }}>Thao tác</th></tr></thead>
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
                  <input list="team-list" defaultValue={u.team ?? ""} placeholder="—"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (u.team ?? "")) patchUser(u.id, { team: v }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    style={{ ...inp, padding: "5px 8px", fontSize: 12.5, width: 140 }} />
                </td>
                <td style={{ color: u.status === "active" ? "var(--green)" : "var(--faint)", fontWeight: 700 }}>{u.status === "active" ? "active" : "khóa"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={() => resetPass(u)} style={actBtn} title="Đặt lại mật khẩu">🔑 Reset</button>
                  <button onClick={() => toggleStatus(u)} style={{ ...actBtn, color: u.status === "active" ? "var(--amber)" : "var(--green)" }}>{u.status === "active" ? "🔒 Khóa" : "🔓 Mở"}</button>
                  <button onClick={() => deleteUser(u)} style={{ ...actBtn, color: "var(--red)" }}>🗑 Xóa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="team-list">{teams.map((t) => <option key={t} value={t} />)}</datalist>
      </div>

      {/* Tổng hợp Team */}
      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Team · {teams.length}</h3>
        <div className="sub" style={{ marginBottom: 10 }}>Mỗi team gom nhân viên cùng nhóm. Thành viên trong team chỉ thấy design của team mình (admin & seller xem tất cả). Thêm/đổi thành viên bằng cách sửa cột Team ở bảng trên.</div>
        {teams.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>Chưa có team nào — gõ tên team ở bảng nhân viên để tạo.</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
            {teams.map((tm) => {
              const members = users.filter((u) => u.team === tm);
              return (
                <div key={tm} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <b style={{ fontSize: 13.5 }}>{tm}</b>
                    <span className="chip" style={{ fontSize: 11 }}>{members.length} người</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {members.map((m) => <div key={m.id} style={{ fontSize: 12.5, color: "var(--ink)" }}>{m.fullName} <span style={{ color: "var(--muted)" }}>· {m.role}</span></div>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Ma trận phân quyền</h3>
        <div className="sub" style={{ marginBottom: 10 }}>Bấm ô để xoay vòng: Toàn quyền → Chỉ xem → Ẩn. Lưu ngay vào database, áp dụng tức thì. Cột admin bị khóa.</div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Module</th>{ROLES.map((r) => <th key={r} style={{ textAlign: "center" }}>{r}</th>)}</tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m}>
                  <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{MODULE_VI[m]}</td>
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
                          {LEVEL_TXT[lv]}
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
