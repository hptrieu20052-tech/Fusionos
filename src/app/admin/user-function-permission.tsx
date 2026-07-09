"use client";
import { useEffect, useMemo, useState } from "react";

type U = { id: string; fullName: string; email: string; role: string; team: string | null };
type Action = { key: string; module: string; label: string };
type Data = {
  users: U[]; modules: string[]; restrictions: string[]; scopes: string[]; scopeResources: string[]; actions: Action[];
  rolePerms: { role: string; module: string; level: number }[];
  roleRestr: { role: string; restrictionKey: string; enabled: boolean }[];
  roleScopes: { role: string; resource: string; scope: string }[];
  roleActs: { role: string; actionKey: string; enabled: boolean }[];
  uPerms: { userId: string; module: string; level: number }[];
  uRestr: { userId: string; restrictionKey: string; enabled: boolean }[];
  uScopes: { userId: string; resource: string; scope: string }[];
  uActs: { userId: string; actionKey: string; enabled: boolean }[];
};

const MODULE_LABEL: Record<string, string> = { dashboard: "Dashboard", orders: "Orders", fulfillment: "Fulfillment", designs: "Design Studio", finance: "Finance", hr: "Staff", stores: "Stores", settings: "Settings" };
const LEVELS = [{ v: 2, label: "Full" }, { v: 1, label: "Xem" }, { v: 0, label: "Ẩn" }];
const SCOPE_LABEL: Record<string, string> = { all: "Tất cả", team: "Cả Team", own: "Chỉ của mình" };
// 1 lựa chọn 4 mức cho mỗi trang (gộp truy cập + phạm vi)
const ACCESS_OPTS = [
  { v: "all", label: "Xem full", bg: "var(--green-soft)", fg: "var(--green)" },
  { v: "team", label: "Xem của Team", bg: "#EAF1FF", fg: "#2563EB" },
  { v: "own", label: "Chỉ của mình", bg: "var(--amber-soft)", fg: "var(--amber)" },
  { v: "hidden", label: "Không được xem", bg: "#F1F3F7", fg: "#6B7280" },
];
const RESTR_LABEL: Record<string, string> = { hide_profit: "Ẩn lợi nhuận / giá vốn", hide_customer_info: "Ẩn thông tin khách hàng", own_orders_only: "Chỉ đơn của mình", own_designs_only: "Chỉ design của mình" };
const RES_LABEL: Record<string, string> = { orders: "Đơn hàng", designs: "Design" };
// own_* thể hiện bằng Phạm vi → chỉ hiện 2 giới hạn còn lại trong panel
const PANEL_RESTR = ["hide_profit", "hide_customer_info"];

export function UserFunctionPermission() {
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");

  const load = async () => { const d = await fetch("/api/admin/user-permissions").then((r) => r.json()); if (d.ok) setData(d); return d; };
  useEffect(() => { load().then((d) => { if (d?.ok) { const f = d.users.find((u: U) => u.role !== "admin") ?? d.users[0]; setSel(f?.id ?? ""); } }); }, []);

  const maps = useMemo(() => {
    if (!data) return null;
    return {
      roleP: new Map(data.rolePerms.map((p) => [`${p.role}:${p.module}`, p.level])),
      uP: new Map(data.uPerms.map((p) => [`${p.userId}:${p.module}`, p.level])),
      roleR: new Map(data.roleRestr.map((r) => [`${r.role}:${r.restrictionKey}`, r.enabled])),
      uR: new Map(data.uRestr.map((r) => [`${r.userId}:${r.restrictionKey}`, r.enabled])),
      roleS: new Map(data.roleScopes.map((s) => [`${s.role}:${s.resource}`, s.scope])),
      uS: new Map(data.uScopes.map((s) => [`${s.userId}:${s.resource}`, s.scope])),
      roleDenied: new Set(data.roleActs.filter((a) => !a.enabled).map((a) => `${a.role}:${a.actionKey}`)),
      uA: new Map(data.uActs.map((a) => [`${a.userId}:${a.actionKey}`, a.enabled])),
    };
  }, [data]);

  if (!data || !maps) return <div className="panel">Đang tải quyền…</div>;
  const user = data.users.find((u) => u.id === sel);
  const nonAdmin = data.users.filter((u) => u.role !== "admin");
  const shown = nonAdmin.filter((u) => !q.trim() || (u.fullName || u.email).toLowerCase().includes(q.trim().toLowerCase()));

  // Hiệu lực (override user → mặc định role)
  const mLevel = (m: string) => maps.uP.get(`${sel}:${m}`) ?? maps.roleP.get(`${user!.role}:${m}`) ?? 0;
  const mIsOwn = (m: string) => maps.uP.has(`${sel}:${m}`);
  const rOn = (k: string) => maps.uR.get(`${sel}:${k}`) ?? maps.roleR.get(`${user!.role}:${k}`) ?? false;
  const rIsOwn = (k: string) => maps.uR.has(`${sel}:${k}`);
  const sVal = (res: string) => maps.uS.get(`${sel}:${res}`) ?? maps.roleS.get(`${user!.role}:${res}`) ?? "all";
  const sIsOwn = (res: string) => maps.uS.has(`${sel}:${res}`);
  const aOn = (k: string) => { const uv = maps.uA.get(`${sel}:${k}`); if (uv !== undefined) return uv; return !maps.roleDenied.has(`${user!.role}:${k}`); };
  const aIsOwn = (k: string) => maps.uA.has(`${sel}:${k}`);

  const send = (kind: string, key: string, value: unknown, reset = false) =>
    fetch("/api/admin/user-permissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: sel, kind, key, value, reset }) });
  const patch = async (kind: string, key: string, value: unknown, reset = false) => { await send(kind, key, value, reset); await load(); };

  // Phạm vi theo trang (dùng orders/designs scope cho enforcement; các trang khác lưu để hiển thị)
  const scopeFor = (m: string) => maps.uS.get(`${sel}:${m}`) ?? maps.roleS.get(`${user!.role}:${m}`) ?? "all";
  const accessOf = (m: string) => (mLevel(m) === 0 ? "hidden" : scopeFor(m));
  const accessIsOwn = (m: string) => maps.uP.has(`${sel}:${m}`) || maps.uS.has(`${sel}:${m}`);
  // Đặt 1 trong 4 mức: ẩn → level 0; còn lại → hiện (full) + lưu phạm vi. Edit tinh chỉnh bằng "Hành động".
  const setAccess = async (m: string, v: string) => {
    if (v === "hidden") await send("module", m, 0);
    else { await send("module", m, 2); await send("scope", m, v); }
    await load();
  };

  const dot = (own: boolean) => <span title={own ? "Đặt riêng cho user" : "Theo role"} style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: own ? "var(--blue, #2563eb)" : "transparent", marginLeft: 6, verticalAlign: "middle" }} />;

  return (
    <div className="panel">
      <h3 style={{ fontWeight: 800, fontSize: 15 }}>Phân quyền theo từng người (Function Permission)</h3>
      <div className="sub" style={{ marginBottom: 12 }}>Chọn người bên trái → chỉnh quyền bên phải. Mặc định theo role; chỉnh ở đây là <b>đặt riêng</b> cho người đó (chấm xanh = riêng). Admin luôn full.</div>
      <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 16, alignItems: "start" }}>
        {/* Danh sách người */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm người…" style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 13 }} />
          </div>
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {shown.map((u) => (
              <button key={u.id} onClick={() => setSel(u.id)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer",
                  background: sel === u.id ? "var(--green-soft)" : "#fff" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{u.fullName || u.email}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>{u.role}</div>
              </button>
            ))}
            {!shown.length && <div style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>Không có người.</div>}
          </div>
        </div>

        {/* Quyền của người đang chọn */}
        {!user ? <div style={{ color: "var(--muted)" }}>Chọn một người.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Quyền xem theo trang — 1 list thẳng hàng, 4 mức */}
            <section>
              <div style={{ fontWeight: 800, fontSize: 12.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 8, letterSpacing: ".3px" }}>Quyền xem theo trang</div>
              <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
                {data.modules.map((m, i) => {
                  const cur = accessOf(m);
                  return (
                    <div key={m} style={{ display: "grid", gridTemplateColumns: "170px 1fr", alignItems: "center", gap: 12, padding: "9px 14px", borderTop: i ? "1px solid var(--line)" : "none" }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{MODULE_LABEL[m] || m}{dot(accessIsOwn(m))}</span>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                        {ACCESS_OPTS.map((o) => {
                          const on = cur === o.v;
                          return (
                            <button key={o.v} onClick={() => setAccess(m, o.v)}
                              style={{ padding: "6px 6px", borderRadius: 8, border: "1px solid", cursor: "pointer", fontSize: 11.5, fontWeight: 800, textAlign: "center", whiteSpace: "nowrap",
                                background: on ? o.bg : "#fff", color: on ? o.fg : "var(--muted)", borderColor: on ? o.fg : "var(--line)" }}>
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="sub" style={{ marginTop: 6, fontSize: 11.5 }}>“Cả Team / Chỉ của mình” lọc dữ liệu ở <b>Đơn hàng</b>, <b>Design</b> (và Dashboard theo đơn). Các trang khác: “Xem full” = hiện, “Không được xem” = ẩn. Quyền sửa/xoá tinh chỉnh ở mục <b>Hành động</b> bên dưới.</div>
            </section>

            {/* Giới hạn */}
            <section>
              <div style={{ fontWeight: 800, fontSize: 12.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 8, letterSpacing: ".3px" }}>Giới hạn dữ liệu</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {PANEL_RESTR.map((k) => (
                  <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    <input type="checkbox" checked={rOn(k)} onChange={() => patch("restriction", k, !rOn(k))} style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--green)" }} />
                    {RESTR_LABEL[k]}{dot(rIsOwn(k))}
                  </label>
                ))}
              </div>
            </section>

            {/* Hành động chi tiết */}
            <section>
              <div style={{ fontWeight: 800, fontSize: 12.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 8, letterSpacing: ".3px" }}>Hành động chi tiết</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                {Array.from(new Set(data.actions.map((a) => a.module))).map((mod) => (
                  <div key={mod} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6 }}>{MODULE_LABEL[mod] || mod}</div>
                    {data.actions.filter((a) => a.module === mod).map((a) => (
                      <label key={a.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}>
                        <input type="checkbox" checked={aOn(a.key)} onChange={() => patch("action", a.key, !aOn(a.key))} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--green)" }} />
                        {a.label}{dot(aIsOwn(a.key))}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
