"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";

/**
 * v449 · Meta Ads Center — đọc bảng meta_insights (cron đồng bộ nền), gộp theo campaign → ad,
 * cột số tính client. Nút 🤖 AI Analyze gọi POST /api/meta-ads/insights → nhận định + đề xuất.
 */
type Row = {
  day: string; campaignId: string; campaignName: string | null; adsetId: string; adsetName: string | null;
  adId: string; adName: string | null; spend: string | null; impressions: number | null; clicks: number | null;
  linkClicks: number | null; atc: number | null; purchases: number | null; revenue: string | null;
};
type AiAction = { ad: string; adId?: string; adsetId?: string; action: string; reason: string };
type Ai = { summary?: string; winners?: string[]; losers?: string[]; actions?: AiAction[]; nextTest?: string };

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const money = (n: number) => "$" + n.toFixed(2);
const num = (n: number) => n.toLocaleString();
const ACTION_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  keep: { bg: "#E9F7EF", fg: "#1F6F45", label: "KEEP" },
  raise_budget: { bg: "#E7F0FF", fg: "#1D4ED8", label: "RAISE $" },
  lower_budget: { bg: "#FEF6E7", fg: "#B7791F", label: "LOWER $" },
  pause: { bg: "#FEE4E2", fg: "#B42318", label: "PAUSE" },
  new_creative: { bg: "#F3E8FF", fg: "#7E22CE", label: "NEW CREATIVE" },
  watch: { bg: "#F1F1F4", fg: "#5B6472", label: "WATCH" },
};

export default function AdsCenterClient() {
  // v453 · DateRangePicker chung của FUSION (preset + lịch chọn khoảng, giống Ads Manager).
  const [dr, setDr] = useState<RangeValue>({ range: "7d" });
  const [rows, setRows] = useState<Row[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  // v451 · trạng thái campaign + filter + thu gọn từng campaign (nhớ localStorage).
  const [campStatus, setCampStatus] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCamp = (id: string, cur: boolean) => {
    setCollapsed((m) => { const n = { ...m, [id]: !cur }; try { localStorage.setItem("metaads.collapsed", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  };
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState<Ai | null>(null);
  const [err, setErr] = useState("");
  // v450b · chọn model AI (danh sách chung của FUSION; trống = default server). Nhớ qua localStorage.
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [aiModel, setAiModel] = useState("");
  useEffect(() => {
    try { const m = localStorage.getItem("metaads.model"); if (m) setAiModel(m); } catch { /* ignore */ }
    try { setCollapsed(JSON.parse(localStorage.getItem("metaads.collapsed") ?? "{}")); } catch { /* ignore */ }
    fetch("/api/books/models?type=text").then((r) => r.json()).then((j) => { if (Array.isArray(j?.models)) setAiModels(j.models); }).catch(() => { /* offline */ });
  }, []);
  const pickModel = (v: string) => { setAiModel(v); try { localStorage.setItem("metaads.model", v); } catch { /* ignore */ } };
  // v450 · Approve: bấm 2 lần để thực thi đề xuất (pause / ±20% budget) qua API.
  const [armIdx, setArmIdx] = useState(-1);
  const [applied, setApplied] = useState<Record<number, string>>({});
  const [applyBusy, setApplyBusy] = useState(-1);
  const applyAction = async (i: number, a: AiAction) => {
    if (applyBusy >= 0 || applied[i]) return;
    if (armIdx !== i) { setArmIdx(i); setTimeout(() => setArmIdx((c) => (c === i ? -1 : c)), 4000); return; }
    setArmIdx(-1); setApplyBusy(i);
    try {
      const j = await fetch("/api/meta-ads/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a.action, adId: a.adId, adsetId: a.adsetId }) }).then((r) => r.json());
      if (j.ok) setApplied((m) => ({ ...m, [i]: j.did ?? "done" }));
      else setErr(j.error ?? "Apply failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setApplyBusy(-1);
  };

  const { from, to } = useMemo(() => rangeToDates(dr), [dr]);

  const load = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const j = await fetch(`/api/meta-ads/insights?from=${from}&to=${to}`).then((r) => r.json());
      if (j.ok) { setRows(j.rows ?? []); setLastSync(j.lastSyncAt); setCampStatus(j.campaignStatus ?? {}); }
      else setErr(j.error ?? "Load failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setBusy(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const syncNow = async () => {
    setSyncBusy(true); setErr("");
    try {
      const j = await fetch("/api/cron/meta-insights").then((r) => r.json());
      if (!j.ok) setErr(j.error ?? "Sync failed");
      await load();
    } catch (e) { setErr(String((e as Error).message)); }
    setSyncBusy(false);
  };

  const analyze = async () => {
    setAiBusy(true); setErr(""); setAi(null);
    try {
      const j = await fetch("/api/meta-ads/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to, model: aiModel || undefined }) }).then((r) => r.json());
      if (j.ok) setAi(j.ai as Ai); else setErr(j.error ?? "Analyze failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setAiBusy(false);
  };

  // Gộp theo campaign → ad
  const grouped = useMemo(() => {
    type Agg = { campId: string; campaign: string; ad: string; adset: string; spend: number; imp: number; lc: number; atc: number; pur: number; rev: number };
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const k = r.adId;
      const a = m.get(k) ?? { campId: r.campaignId, campaign: r.campaignName ?? "—", ad: r.adName ?? r.adId, adset: r.adsetName ?? "", spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 };
      a.spend += Number(r.spend) || 0; a.imp += r.impressions ?? 0; a.lc += r.linkClicks ?? 0;
      a.atc += r.atc ?? 0; a.pur += r.purchases ?? 0; a.rev += Number(r.revenue) || 0;
      m.set(k, a);
    }
    const byCamp = new Map<string, { name: string; ads: Agg[] }>();
    for (const a of Array.from(m.values())) {
      const g = byCamp.get(a.campId) ?? { name: a.campaign, ads: [] };
      g.ads.push(a); byCamp.set(a.campId, g);
    }
    // v454 · sắp theo AD SET (nhóm) rồi spend — render sẽ chèn hàng tiêu đề mỗi khi đổi ad set.
    for (const g of Array.from(byCamp.values())) g.ads.sort((x: Agg, y: Agg) => x.adset.localeCompare(y.adset) || y.spend - x.spend);
    return Array.from(byCamp.entries()).sort((x, y) => y[1].ads.reduce((s, a) => s + a.spend, 0) - x[1].ads.reduce((s, a) => s + a.spend, 0));
  }, [rows]);

  const totals = useMemo(() => {
    const t = { spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 };
    for (const r of rows) { t.spend += Number(r.spend) || 0; t.imp += r.impressions ?? 0; t.lc += r.linkClicks ?? 0; t.atc += r.atc ?? 0; t.pur += r.purchases ?? 0; t.rev += Number(r.revenue) || 0; }
    return t;
  }, [rows]);

  const th: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 10.5, fontWeight: 800, letterSpacing: ".3px", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 12.5, whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <b style={{ fontSize: 17 }}>📣 Meta Ads Center</b>
        <DateRangePicker value={dr} onChange={setDr} />
        {/* v451 · lọc campaign theo trạng thái thật từ Meta */}
        <div style={{ display: "flex", gap: 4, background: "#F1F3F6", borderRadius: 10, padding: 3 }}>
          {(["all", "active", "inactive"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              style={{ border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: statusFilter === f ? "#fff" : "transparent", color: statusFilter === f ? "var(--ink)" : "var(--muted)",
                boxShadow: statusFilter === f ? "0 1px 2px rgba(16,24,40,.12)" : "none" }}>
              {f === "all" ? "All" : f === "active" ? "Active" : "Inactive"}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {lastSync ? `Synced ${new Date(lastSync).toLocaleString()}` : "Never synced — bấm Sync now"}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={syncNow} disabled={syncBusy} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: syncBusy ? .6 : 1 }}>
          {syncBusy ? "Syncing…" : "⟳ Sync now"}
        </button>
        <select value={aiModel} onChange={(e) => pickModel(e.target.value)} title="AI model"
          style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "7px 8px", fontSize: 12.5, background: "#fff", maxWidth: 190 }}>
          <option value="">Model: server default</option>
          {aiModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button onClick={analyze} disabled={aiBusy || !rows.length} style={{ border: "none", background: "#7C5CFF", color: "#fff", borderRadius: 10, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: aiBusy || !rows.length ? .6 : 1 }}>
          {aiBusy ? "Analyzing…" : "🤖 AI Analyze"}
        </button>
      </div>
      {err && <div style={{ ...card, padding: "10px 16px", borderColor: "#F5CFCF", background: "#FDECEC", color: "#C0392B", fontSize: 13, fontWeight: 600 }}>{err}</div>}

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {[
          ["Spend", money(totals.spend)],
          ["Link clicks", num(totals.lc)],
          ["CTR (link)", totals.imp ? (100 * totals.lc / totals.imp).toFixed(2) + "%" : "—"],
          ["Add to cart", num(totals.atc)],
          ["Cost / ATC", totals.atc ? money(totals.spend / totals.atc) : "—"],
          ["Purchases", num(totals.pur)],
          ["CPA", totals.pur ? money(totals.spend / totals.pur) : "—"],
          ["ROAS", totals.spend ? (totals.rev / totals.spend).toFixed(2) : "—"],
        ].map(([label, v]) => (
          <div key={label as string} style={{ ...card, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".3px", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* AI result */}
      {ai && (
        <div style={{ ...card, padding: 18, borderColor: "#D8CCFF", background: "#FBFAFF" }}>
          <b style={{ fontSize: 14 }}>🤖 AI Analysis</b>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: "8px 0 10px" }}>{ai.summary}</p>
          {(ai.actions ?? []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(ai.actions ?? []).map((a, i) => {
                const st = ACTION_STYLE[a.action] ?? ACTION_STYLE.watch;
                const executable = ["pause", "raise_budget", "lower_budget"].includes(a.action) && (a.adId || a.adsetId);
                return (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
                    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: st.bg, color: st.fg, marginTop: 1 }}>{st.label}</span>
                    <span style={{ flex: 1 }}><b>{a.ad}</b> — {a.reason}</span>
                    {applied[i]
                      ? <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#1F6F45" }}>✓ {applied[i]}</span>
                      : executable && (
                        <button onClick={() => applyAction(i, a)} disabled={applyBusy >= 0}
                          style={{ flexShrink: 0, border: "none", borderRadius: 8, padding: "3px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer",
                            background: armIdx === i ? "#B45309" : "#111827", color: "#fff", opacity: applyBusy >= 0 && applyBusy !== i ? .5 : 1 }}>
                          {applyBusy === i ? "…" : armIdx === i ? "Confirm?" : "Approve"}
                        </button>
                      )}
                  </div>
                );
              })}
            </div>
          )}
          {ai.nextTest && <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>💡 {ai.nextTest}</p>}
        </div>
      )}

      {/* Tables per campaign */}
      {busy && !rows.length ? <div style={{ ...card, padding: 24, textAlign: "center", color: "var(--muted)" }}>Loading…</div> : null}
      {!busy && !rows.length ? <div style={{ ...card, padding: 24, textAlign: "center", color: "var(--muted)" }}>No data yet — bấm ⟳ Sync now (cần env META_SYSTEM_TOKEN, đã chạy MIGRATION_v449).</div> : null}
      {grouped.map(([campId, g]) => {
        const ads = g.ads;
        const status = campStatus[campId] ?? "";
        const isActive = status === "ACTIVE";
        // Filter theo trạng thái; campaign không rõ status (chưa sync) chỉ hiện ở All.
        if (statusFilter === "active" && !isActive) return null;
        if (statusFilter === "inactive" && (isActive || !status)) return null;
        // Mặc định: campaign đang tắt thì thu gọn sẵn cho đỡ rối.
        const isCollapsed = collapsed[campId] ?? (status ? !isActive : false);
        const ct = ads.reduce((s, a) => ({ spend: s.spend + a.spend, imp: s.imp + a.imp, lc: s.lc + a.lc, atc: s.atc + a.atc, pur: s.pur + a.pur, rev: s.rev + a.rev }), { spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 });
        return (
          <div key={campId} style={{ ...card, padding: "6px 6px 2px", overflow: "hidden" }}>
            <div onClick={() => toggleCamp(campId, isCollapsed)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 6px", cursor: "pointer", userSelect: "none" }}>
              <span style={{ fontSize: 11, color: "var(--muted)", transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform .12s", width: 12, display: "inline-block" }}>▼</span>
              <b style={{ fontSize: 14 }}>{g.name}</b>
              {status && (
                <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, letterSpacing: ".3px",
                  background: isActive ? "#E9F7EF" : "#F1F1F4", color: isActive ? "#1F6F45" : "#8794A5" }}>
                  {isActive ? "ACTIVE" : status}
                </span>
              )}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{ads.length} ads · {money(ct.spend)} · {ct.pur} purchases{ct.spend ? ` · ROAS ${(ct.rev / ct.spend).toFixed(2)}` : ""}</span>
            </div>
            <div style={{ overflowX: "auto", display: isCollapsed ? "none" : "block" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={{ ...th, textAlign: "left" }}>Ad</th>
                  <th style={th}>Spend</th><th style={th}>Impr</th><th style={th}>Link clicks</th><th style={th}>CTR</th><th style={th}>CPC</th>
                  <th style={th}>ATC</th><th style={th}>$/ATC</th><th style={th}>Purch</th><th style={th}>CPA</th><th style={th}>Revenue</th><th style={th}>ROAS</th>
                </tr></thead>
                <tbody>
                  {ads.map((a, ai) => (<>
                    {/* v454 · hàng AD SET — hiện khi bắt đầu nhóm mới, kèm subtotal của cả set. */}
                    {(ai === 0 || ads[ai - 1].adset !== a.adset) && (() => {
                      const grp = ads.filter((x) => x.adset === a.adset);
                      const gs = grp.reduce((s2, x) => ({ spend: s2.spend + x.spend, atc: s2.atc + x.atc, pur: s2.pur + x.pur, rev: s2.rev + x.rev }), { spend: 0, atc: 0, pur: 0, rev: 0 });
                      return (
                        <tr key={"set-" + a.adset} style={{ background: "#F7F9FC", borderBottom: "1px solid #EDF0F4" }}>
                          <td colSpan={12} style={{ padding: "6px 10px", fontSize: 11, fontWeight: 800, color: "#5B6472" }}>
                            ▪ {a.adset || "(no ad set)"}
                            <span style={{ fontWeight: 600, marginLeft: 8, color: "var(--muted)" }}>
                              {grp.length} ad{grp.length > 1 ? "s" : ""} · {money(gs.spend)} · {gs.atc} ATC · {gs.pur} purch{gs.spend ? ` · ROAS ${(gs.rev / gs.spend).toFixed(2)}` : ""}
                            </span>
                          </td>
                        </tr>
                      );
                    })()}
                    <tr key={a.ad} style={{ borderBottom: "1px solid #F1F3F6" }}>
                      <td style={{ ...td, textAlign: "left", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", paddingLeft: 22 }} title={`${a.adset} › ${a.ad}`}>{a.ad}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{money(a.spend)}</td>
                      <td style={td}>{num(a.imp)}</td>
                      <td style={td}>{num(a.lc)}</td>
                      <td style={{ ...td, fontWeight: 700, color: a.imp && 100 * a.lc / a.imp >= 1.5 ? "#1F6F45" : a.imp ? "#B7791F" : "inherit" }}>{a.imp ? (100 * a.lc / a.imp).toFixed(2) + "%" : "—"}</td>
                      <td style={td}>{a.lc ? money(a.spend / a.lc) : "—"}</td>
                      <td style={td}>{num(a.atc)}</td>
                      <td style={td}>{a.atc ? money(a.spend / a.atc) : "—"}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{num(a.pur)}</td>
                      <td style={{ ...td, color: a.pur && a.spend / a.pur <= 25 ? "#1F6F45" : "inherit" }}>{a.pur ? money(a.spend / a.pur) : "—"}</td>
                      <td style={td}>{money(a.rev)}</td>
                      <td style={{ ...td, fontWeight: 800, color: a.spend && a.rev / a.spend >= 1.5 ? "#1F6F45" : a.spend && a.rev > 0 ? "#B7791F" : "inherit" }}>{a.spend ? (a.rev / a.spend).toFixed(2) : "—"}</td>
                    </tr>
                  </>))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
