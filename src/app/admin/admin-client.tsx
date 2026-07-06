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
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Team</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.fullName}</b></td>
                <td>{u.email}</td>
                <td><span className="chip">{u.role}</span></td>
                <td>{u.team ?? "—"}</td>
                <td style={{ color: u.status === "active" ? "var(--green)" : "var(--faint)", fontWeight: 700 }}>{u.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
