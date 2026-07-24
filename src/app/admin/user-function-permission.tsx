"use client";
import { useLang } from "@/components/lang-provider";
import { useEffect, useMemo, useState } from "react";

type U = { id: string; fullName: string; email: string; role: string; team: string | null };
type Action = { key: string; module: string; label: string };
type Data = {
  users: U[]; modules: string[]; restrictions: string[]; scopes: string[]; scopeResources: string[]; actions: Action[];
  rolePerms: { role: string; module: string; level: number }[];
  roleScopes: { role: string; resource: string; scope: string }[];
  uPerms: { userId: string; module: string; level: number }[];
  uScopes: { userId: string; resource: string; scope: string }[];
};

const MODULE_LABEL: Record<string, string> = { dashboard: "Dashboard", orders: "Orders", fulfillment: "Fulfillment", designs: "Design Studio", products: "Products", reviews: "Scoring", statsDesigners: "Designer Stats", finance: "Finance", hr: "Staff", stores: "Stores", support: "Customer Messages", marketing: "Marketing", financeTiktok: "Finance (TikTok)", bookStudio: "Book Studio (AI)", genImage: "Gen Image", genVideo: "Gen Video", settings: "Settings" };
// Bố cục bảng quyền — đồng điệu với Menu. Ẩn fulfillment/reviews/statsDesigners (module vẫn tồn tại, route vẫn chạy). Gộp Seller Hub.
const PERM_SECTIONS: { title: string | null; grouped?: boolean; mods: string[] }[] = [
  { title: null, mods: ["dashboard", "orders", "designs"] },
  // AI Agent — Book Studio + Gen Image (beta): bật cho seller nào được dùng thử.
  { title: "AI Agent (beta)", mods: ["bookStudio", "genImage", "genVideo"] },
  // Seller Hub: 1 dòng set CHUNG cho Products + Customer Messages + Marketing.
  { title: "Seller Hub", grouped: true, mods: ["products", "support", "marketing", "financeTiktok"] },
  { title: null, mods: ["finance", "stores", "hr", "settings"] },
];
// 1 lựa chọn 4 mức cho mỗi trang (gộp truy cập + phạm vi)
const accessOpts = (t: (k: string) => string) => ([
  { v: "all", label: "View full", bg: "var(--green-soft)", fg: "var(--green)" },
  { v: "team", label: t("perm.viewTeam"), bg: "#EAF1FF", fg: "#2563EB" },
  { v: "own", label: "Own only", bg: "var(--amber-soft)", fg: "var(--amber)" },
  { v: "hidden", label: t("perm.cantView"), bg: "#F1F3F7", fg: "#6B7280" },
]);
type Change = { kind: string; key: string; value: unknown };

export function UserFunctionPermission() {
  const { t } = useLang();
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState("");
  const [q, setQ] = useState("");
  const [changes, setChanges] = useState<Map<string, Change>>(new Map());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => { const d = await fetch("/api/admin/user-permissions").then((r) => r.json()); if (d.ok) setData(d); return d; };
  useEffect(() => { load().then((d) => { if (d?.ok) { const f = d.users.find((u: U) => u.role !== "admin") ?? d.users[0]; setSel(f?.id ?? ""); } }); }, []);

  const maps = useMemo(() => {
    if (!data) return null;
    return {
      roleP: new Map(data.rolePerms.map((p) => [`${p.role}:${p.module}`, p.level])),
      uP: new Map(data.uPerms.map((p) => [`${p.userId}:${p.module}`, p.level])),
      roleS: new Map(data.roleScopes.map((s) => [`${s.role}:${s.resource}`, s.scope])),
      uS: new Map(data.uScopes.map((s) => [`${s.userId}:${s.resource}`, s.scope])),
    };
  }, [data]);

  if (!data || !maps) return <div className="panel">{t("perm.loading")}</div>;
  const user = data.users.find((u) => u.id === sel);
  const nonAdmin = data.users.filter((u) => u.role !== "admin");
  const shown = nonAdmin.filter((u) => !q.trim() || (u.fullName || u.email).toLowerCase().includes(q.trim().toLowerCase()));

  const changed = (kind: string, key: string) => changes.get(`${kind}:${key}`);
  const mLevel = (m: string): number => { const c = changed("module", m); if (c) return c.value as number; return (maps.uP.get(`${sel}:${m}`) ?? maps.roleP.get(`${user!.role}:${m}`) ?? 0) as number; };
  const scopeFor = (m: string): string => { const c = changed("scope", m); if (c) return c.value as string; return (maps.uS.get(`${sel}:${m}`) ?? maps.roleS.get(`${user!.role}:${m}`) ?? "all") as string; };
  const accessOf = (m: string) => (mLevel(m) === 0 ? "hidden" : scopeFor(m));
  const isOwn = (m: string) => maps.uP.has(`${sel}:${m}`) || maps.uS.has(`${sel}:${m}`) || changes.has(`module:${m}`) || changes.has(`scope:${m}`);

  const stage = (kind: string, key: string, value: unknown) => setChanges((prev) => new Map(prev).set(`${kind}:${key}`, { kind, key, value }));
  const setAccess = (m: string, v: string) => { if (v === "hidden") stage("module", m, 0); else { stage("module", m, 2); stage("scope", m, v); } };

  const selectUser = (id: string) => { setSel(id); setChanges(new Map()); setMsg(""); };

  const save = async () => {
    if (!changes.size) return;
    setSaving(true);
    try {
      for (const c of Array.from(changes.values())) {
        await fetch("/api/admin/user-permissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: sel, kind: c.kind, key: c.key, value: c.value }) });
      }
      await load();
      setChanges(new Map());
      setMsg(t("perm.savedPermFor") + (user?.fullName || user?.email));
      setTimeout(() => setMsg(""), 3000);
    } catch (e) { setMsg("✗ " + (e as Error).message); }
    setSaving(false);
  };

  const dot = (own: boolean) => <span title={own ? t("perm.setForPerson") : "Theo role"} style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: own ? "#2563EB" : "transparent", marginLeft: 6, verticalAlign: "middle" }} />;

  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{t("perm.title")}</h3>
          <div className="sub">{t("perm.pickThenSave")} <b>Save</b>{t("perm.pageHint2")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {msg && <span style={{ fontSize: 12.5, fontWeight: 700, color: msg.startsWith("✓") ? "var(--green)" : "var(--red, #dc2626)" }}>{msg}</span>}
          <button onClick={save} disabled={!changes.size || saving}
            style={{ padding: "9px 20px", borderRadius: 10, border: "none", fontWeight: 800, fontSize: 13, cursor: changes.size && !saving ? "pointer" : "not-allowed",
              background: changes.size && !saving ? "var(--ink, #111827)" : "#E5E7EB", color: changes.size && !saving ? "#fff" : "#9CA3AF" }}>
            {saving ? "Saving…" : changes.size ? t("perm.saveN").replace("{n}", String(changes.size)) : t("perm.saved")}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 16, alignItems: "start", marginTop: 12 }}>
        {/* Danh sách người */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("perm.searchPerson")} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 13 }} />
          </div>
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {shown.map((u) => (
              <button key={u.id} onClick={() => selectUser(u.id)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", background: sel === u.id ? "var(--green-soft)" : "#fff" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{u.fullName || u.email}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>{u.role}</div>
              </button>
            ))}
            {!shown.length && <div style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>{t("perm.noPeople")}</div>}
          </div>
        </div>

        {/* Quyền xem theo trang — 1 list thẳng hàng, 4 mức */}
        {!user ? <div style={{ color: "var(--muted)" }}>{t("perm.pickOne")}</div> : (
          <div>
            {changes.size > 0 && <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700, marginBottom: 8 }}>{changes.size} unsaved change(s) — click Save (switching person discards changes).</div>}
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
              {(() => {
                const have = new Set(data.modules);
                const rows: React.ReactNode[] = [];
                let first = true;
                const rowBtns = (cur: string, apply: (v: string) => void) => (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                    {accessOpts(t).map((o) => {
                      const on = cur === o.v;
                      return (
                        <button key={o.v} onClick={() => apply(o.v)}
                          style={{ padding: "6px 6px", borderRadius: 8, border: "1px solid", cursor: "pointer", fontSize: 11.5, fontWeight: 800, textAlign: "center", whiteSpace: "nowrap",
                            background: on ? o.bg : "#fff", color: on ? o.fg : "var(--muted)", borderColor: on ? o.fg : "var(--line)" }}>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                );
                for (const sec of PERM_SECTIONS) {
                  const mods = sec.mods.filter((m) => have.has(m));
                  if (!mods.length) continue;
                  if (sec.grouped) {
                    // 1 dòng set CHUNG cho cả nhóm (Seller Hub). Giá trị hiển thị theo module đầu; bấm áp cho tất cả.
                    const cur = accessOf(mods[0]);
                    rows.push(
                      <div key={`g_${sec.title}`} style={{ display: "grid", gridTemplateColumns: "170px 1fr", alignItems: "center", gap: 12, padding: "9px 14px", borderTop: first ? "none" : "1px solid var(--line)" }}>
                        <span style={{ fontWeight: 800, fontSize: 13, color: "var(--blue)" }}>{sec.title}{dot(mods.some((m) => isOwn(m)))}</span>
                        {rowBtns(cur, (v) => mods.forEach((m) => setAccess(m, v)))}
                      </div>
                    );
                    first = false;
                    continue;
                  }
                  for (const m of mods) {
                    rows.push(
                      <div key={m} style={{ display: "grid", gridTemplateColumns: "170px 1fr", alignItems: "center", gap: 12, padding: "9px 14px", borderTop: first ? "none" : "1px solid var(--line)" }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{MODULE_LABEL[m] || m}{dot(isOwn(m))}</span>
                        {rowBtns(accessOf(m), (v) => setAccess(m, v))}
                      </div>
                    );
                    first = false;
                  }
                }
                return rows;
              })()}
            </div>
            <div className="sub" style={{ marginTop: 8, fontSize: 11.5 }}>{t("perm.teamOwnHint")} <b>Orders</b>, <b>Design</b> {t("perm.pageHint1")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
