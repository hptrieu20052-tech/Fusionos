"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * v449 · Meta Ads Center — đọc bảng meta_insights (cron đồng bộ nền), gộp theo campaign → ad,
 * cột số tính client. Nút 🤖 AI Analyze gọi POST /api/meta-ads/insights → nhận định + đề xuất.
 */
type Row = {
  day: string; campaignId: string; campaignName: string | null; adsetId: string; adsetName: string | null;
  adId: string; adName: string | null; spend: string | null; impressions: number | null; clicks: number | null;
  linkClicks: number | null; atc: number | null; purchases: number | null; revenue: string | null;
};
type AiAction = { ad: string; action: string; reason: string };
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
  const [days, setDays] = useState(14);
  const [rows, setRows] = useState<Row[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState<Ai | null>(null);
  const [err, setErr] = useState("");

  const from = useMemo(() => new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10), [days]);

  const load = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const j = await fetch(`/api/meta-ads/insights?from=${from}`).then((r) => r.json());
      if (j.ok) { setRows(j.rows ?? []); setLastSync(j.lastSyncAt); }
      else setErr(j.error ?? "Load failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setBusy(false);
  }, [from]);
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
      const j = await fetch("/api/meta-ads/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from }) }).then((r) => r.json());
      if (j.ok) setAi(j.ai as Ai); else setErr(j.error ?? "Analyze failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setAiBusy(false);
  };

  // Gộp theo campaign → ad
  const grouped = useMemo(() => {
    type Agg = { campaign: string; ad: string; adset: string; spend: number; imp: number; lc: number; atc: number; pur: number; rev: number };
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const k = r.adId;
      const a = m.get(k) ?? { campaign: r.campaignName ?? "—", ad: r.adName ?? r.adId, adset: r.adsetName ?? "", spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 };
      a.spend += Number(r.spend) || 0; a.imp += r.impressions ?? 0; a.lc += r.linkClicks ?? 0;
      a.atc += r.atc ?? 0; a.pur += r.purchases ?? 0; a.rev += Number(r.revenue) || 0;
      m.set(k, a);
    }
    const byCamp = new Map<string, Agg[]>();
    for (const a of Array.from(m.values())) { const list = byCamp.get(a.campaign) ?? []; list.push(a); byCamp.set(a.campaign, list); }
    for (const list of Array.from(byCamp.values())) list.sort((x: Agg, y: Agg) => y.spend - x.spend);
    return Array.from(byCamp.entries()).sort((x, y) => y[1].reduce((s, a) => s + a.spend, 0) - x[1].reduce((s, a) => s + a.spend, 0));
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
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "7px 10px", fontSize: 13, background: "#fff" }}>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={28}>Last 28 days</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {lastSync ? `Synced ${new Date(lastSync).toLocaleString()}` : "Never synced — bấm Sync now"}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={syncNow} disabled={syncBusy} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: syncBusy ? .6 : 1 }}>
          {syncBusy ? "Syncing…" : "⟳ Sync now"}
        </button>
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
                return (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
                    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: st.bg, color: st.fg, marginTop: 1 }}>{st.label}</span>
                    <span><b>{a.ad}</b> — {a.reason}</span>
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
      {grouped.map(([camp, ads]) => {
        const ct = ads.reduce((s, a) => ({ spend: s.spend + a.spend, imp: s.imp + a.imp, lc: s.lc + a.lc, atc: s.atc + a.atc, pur: s.pur + a.pur, rev: s.rev + a.rev }), { spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 });
        return (
          <div key={camp} style={{ ...card, padding: "6px 6px 2px", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "10px 12px 6px" }}>
              <b style={{ fontSize: 14 }}>{camp}</b>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{ads.length} ads · {money(ct.spend)} · {ct.pur} purchases{ct.spend ? ` · ROAS ${(ct.rev / ct.spend).toFixed(2)}` : ""}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={{ ...th, textAlign: "left" }}>Ad</th>
                  <th style={th}>Spend</th><th style={th}>Impr</th><th style={th}>Link clicks</th><th style={th}>CTR</th><th style={th}>CPC</th>
                  <th style={th}>ATC</th><th style={th}>$/ATC</th><th style={th}>Purch</th><th style={th}>CPA</th><th style={th}>Revenue</th><th style={th}>ROAS</th>
                </tr></thead>
                <tbody>
                  {ads.map((a) => (
                    <tr key={a.ad} style={{ borderBottom: "1px solid #F1F3F6" }}>
                      <td style={{ ...td, textAlign: "left", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis" }} title={`${a.adset} › ${a.ad}`}>{a.ad}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
