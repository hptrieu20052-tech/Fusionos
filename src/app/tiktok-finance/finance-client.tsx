"use client";
import { useMemo, useState } from "react";

type Store = { id: string; name: string; sellerId: string | null };
type Seller = { id: string; name: string | null };
type Row = { id: string; time: number; currency: string; settlement: string; revenue: string; fee: string; adjustment: string; status: string; paymentId: string; paidTime: number };

const fmtDate = (t: number) => (t ? new Date(t * 1000).toLocaleDateString() : "—");
const money = (v: string, cur: string) => { const n = Number(v); return isNaN(n) || v === "" ? "—" : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`; };
const statusColor = (s: string) => s === "PAID" ? { bg: "#E7F6EC", fg: "#1E8E4E" } : s === "PROCESSING" ? { bg: "#FFF6E5", fg: "#B7791F" } : s === "FAILED" ? { bg: "#FDECEC", fg: "#C0392B" } : { bg: "#EEF1F5", fg: "#5B6472" };
const sel: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13, background: "#fff" };

export default function FinanceClient({ stores, sellers = [] }: { stores: Store[]; sellers?: Seller[] }) {
  const [seller, setSeller] = useState("");
  const shopOptions = useMemo(() => (seller ? stores.filter((s) => s.sellerId === seller) : stores), [stores, seller]);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (!storeId) return;
    setLoading(true); setErr(""); setLoaded(false);
    const qs = new URLSearchParams({ storeId });
    if (status) qs.set("status", status);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    try {
      const j = await fetch(`/api/tiktok/finance/statements?${qs.toString()}`).then((r) => r.json());
      if (j.ok) { setRows(j.statements); setLoaded(true); }
      else setErr(j.error || "Failed to load");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setLoading(false);
  };

  const totalPaid = rows.filter((r) => r.status === "PAID").reduce((t, r) => t + (Number(r.settlement) || 0), 0);
  const cur = rows[0]?.currency ?? "";
  const scopeHint = err.includes("40006") || err.toLowerCase().includes("scope") || err.includes("denied") || err.includes("105005");

  if (!stores.length) return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Finance · TikTok</h2><p style={{ color: "var(--muted)" }}>No TikTok store connected.</p></div>;

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Finance · TikTok <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>Payouts</span></h2>
        <div style={{ flex: 1 }} />
        {sellers.length > 1 && (
          <select value={seller} onChange={(e) => { setSeller(e.target.value); setStoreId(""); }} style={sel}>
            <option value="">All sellers</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name || "—"}</option>)}
          </select>
        )}
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={sel}>
          <option value="">Select shop…</option>
          {shopOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={sel}>
          <option value="">All status</option>
          <option value="PAID">PAID</option>
          <option value="PROCESSING">PROCESSING</option>
          <option value="FAILED">FAILED</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From" style={sel} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To" style={sel} />
        <button onClick={load} disabled={loading || !storeId} style={{ ...sel, cursor: loading || !storeId ? "default" : "pointer", fontWeight: 700, background: "var(--blue)", color: "#fff", border: 0, opacity: loading || !storeId ? 0.6 : 1 }}>{loading ? "Loading…" : "Load payouts"}</button>
      </div>

      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>✗ {err}{scopeHint && " — this needs the seller.finance.info scope. Add it in Partner Center and re-authorize the shop."}</div>}

      {loaded && rows.length > 0 && (
        <div style={{ fontSize: 13, marginBottom: 10 }}>Total paid out (this page): <b style={{ color: "var(--green)" }}>{money(String(totalPaid), cur)}</b> · {rows.length} statement(s)</div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase" }}>
              <th style={{ padding: "8px 6px" }}>Statement date</th>
              <th style={{ padding: "8px 6px" }}>Revenue</th>
              <th style={{ padding: "8px 6px" }}>Fee</th>
              <th style={{ padding: "8px 6px" }}>Adjustment</th>
              <th style={{ padding: "8px 6px" }}>Settlement (payout)</th>
              <th style={{ padding: "8px 6px" }}>Status</th>
              <th style={{ padding: "8px 6px" }}>Paid date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sc = statusColor(r.status);
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 6px" }}>{fmtDate(r.time)}</td>
                  <td style={{ padding: "8px 6px" }}>{money(r.revenue, r.currency)}</td>
                  <td style={{ padding: "8px 6px", color: "var(--red)" }}>{money(r.fee, r.currency)}</td>
                  <td style={{ padding: "8px 6px" }}>{money(r.adjustment, r.currency)}</td>
                  <td style={{ padding: "8px 6px", fontWeight: 700 }}>{money(r.settlement, r.currency)}</td>
                  <td style={{ padding: "8px 6px" }}><span style={{ background: sc.bg, color: sc.fg, fontWeight: 700, fontSize: 11, borderRadius: 6, padding: "2px 8px" }}>{r.status || "—"}</span></td>
                  <td style={{ padding: "8px 6px", color: "var(--muted)" }}>{fmtDate(r.paidTime)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loaded && !rows.length && <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>No statements in this range.</div>}
        {!loaded && !err && <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>Pick a shop and click “Load payouts”.</div>}
      </div>
    </div>
  );
}
