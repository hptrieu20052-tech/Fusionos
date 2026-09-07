"use client";
import { useMemo, useState } from "react";
import DateRangePicker, { rangeToDates, type RangeValue } from "@/components/date-range";

/**
 * v436 · Finance · TikTok — kéo payout của TẤT CẢ shop đang gắn API trong 1 lần
 * (All shops), thẻ tổng Paid/Processing/Failed, gộp theo ngày, cột Shop.
 * "On hold" của Seller Center = tiền đơn CHƯA tới kỳ quyết toán — TikTok không mở
 * API cho số này nên chỉ xem được trong Seller Center.
 */
type Store = { id: string; name: string; sellerId: string | null };
type Seller = { id: string; name: string | null };
type Row = { storeId?: string; storeName?: string; id: string; time: number; currency: string; settlement: string; revenue: string; fee: string; adjustment: string; status: string; paymentId: string; paidTime: number };

const fmtDate = (t: number) => (t ? new Date(t * 1000).toLocaleDateString() : "—");
const dayKey = (t: number) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const money = (v: string | number, cur: string) => { const n = Number(v); return isNaN(n) || v === "" ? "—" : `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`; };
const statusColor = (s: string) => s === "PAID" ? { bg: "#E7F6EC", fg: "#1E8E4E" } : s === "PROCESSING" ? { bg: "#FFF6E5", fg: "#B7791F" } : s === "FAILED" ? { bg: "#FDECEC", fg: "#C0392B" } : { bg: "#EEF1F5", fg: "#5B6472" };
const sel: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13, background: "#fff" };
const card = (accent: string): React.CSSProperties => ({ flex: "1 1 150px", minWidth: 150, border: "1px solid var(--line)", borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: "12px 16px", background: "#fff" });

export default function FinanceClient({ stores, sellers = [] }: { stores: Store[]; sellers?: Seller[] }) {
  const [seller, setSeller] = useState("");
  const shopOptions = useMemo(() => (seller ? stores.filter((s) => s.sellerId === seller) : stores), [stores, seller]);
  const [storeId, setStoreId] = useState("");            // "" = ALL shops
  const [status, setStatus] = useState("");
  const [dr, setDr] = useState<RangeValue>({ range: "30d" });
  const [groupDay, setGroupDay] = useState(false);       // gộp theo ngày
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [storeErrs, setStoreErrs] = useState<{ store: string; error: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true); setErr(""); setStoreErrs([]); setLoaded(false);
    const qs = new URLSearchParams();
    if (storeId) qs.set("storeId", storeId);
    if (seller) qs.set("seller", seller);
    if (status) qs.set("status", status);
    const { from, to } = rangeToDates(dr);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    try {
      const j = await fetch(`/api/tiktok/finance/overview?${qs.toString()}`).then((r) => r.json());
      if (j.ok) { setRows(j.statements); setStoreErrs(j.errors ?? []); setLoaded(true); }
      else setErr(j.error || "Failed to load");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setLoading(false);
  };

  // ── Tổng theo status (theo currency đầu tiên — các shop US đều USD) ─────────
  const cur = rows[0]?.currency ?? "USD";
  const sumBy = (st: string) => rows.filter((r) => r.status === st).reduce((t, r) => t + (Number(r.settlement) || 0), 0);
  const totPaid = useMemo(() => sumBy("PAID"), [rows]);           // eslint-disable-line react-hooks/exhaustive-deps
  const totProc = useMemo(() => sumBy("PROCESSING"), [rows]);     // eslint-disable-line react-hooks/exhaustive-deps
  const totFail = useMemo(() => sumBy("FAILED"), [rows]);         // eslint-disable-line react-hooks/exhaustive-deps

  // ── Gộp theo shop (khi xem All shops) ───────────────────────────────────────
  const byStore = useMemo(() => {
    const m = new Map<string, { name: string; paid: number; proc: number; n: number }>();
    for (const r of rows) {
      const k = r.storeName ?? "—";
      const e = m.get(k) ?? { name: k, paid: 0, proc: 0, n: 0 };
      if (r.status === "PAID") e.paid += Number(r.settlement) || 0;
      if (r.status === "PROCESSING") e.proc += Number(r.settlement) || 0;
      e.n++; m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => (b.paid + b.proc) - (a.paid + a.proc));
  }, [rows]);

  // ── Gộp theo ngày ──────────────────────────────────────────────────────────
  const byDay = useMemo(() => {
    const m = new Map<string, { day: string; paid: number; proc: number; fail: number; n: number }>();
    for (const r of rows) {
      const k = dayKey(r.time);
      const e = m.get(k) ?? { day: k, paid: 0, proc: 0, fail: 0, n: 0 };
      const v = Number(r.settlement) || 0;
      if (r.status === "PAID") e.paid += v; else if (r.status === "PROCESSING") e.proc += v; else if (r.status === "FAILED") e.fail += v;
      e.n++; m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => b.day.localeCompare(a.day));
  }, [rows]);

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
          <option value="">All shops ({shopOptions.length})</option>
          {shopOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={sel}>
          <option value="">All status</option>
          <option value="PAID">PAID</option>
          <option value="PROCESSING">PROCESSING</option>
          <option value="FAILED">FAILED</option>
        </select>
        <DateRangePicker value={dr} onChange={(v) => setDr(v)} align="right" />
        <button onClick={load} disabled={loading} style={{ ...sel, cursor: loading ? "default" : "pointer", fontWeight: 700, background: "var(--blue)", color: "#fff", border: 0, opacity: loading ? 0.6 : 1 }}>{loading ? "Loading…" : "Load payouts"}</button>
      </div>

      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>✗ {err}{scopeHint && " — this needs the seller.finance.info scope. Add it in Partner Center and re-authorize the shop."}</div>}
      {storeErrs.map((e, i) => <div key={i} style={{ fontSize: 12, color: "#B7791F", marginBottom: 4 }}>⚠ {e.store}: {e.error}</div>)}

      {/* ── THẺ TỔNG ─────────────────────────────────────────────────────── */}
      {loaded && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={card("#1E8E4E")}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Paid</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1E8E4E" }}>{money(totPaid, cur)}</div>
          </div>
          <div style={card("#B7791F")}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Processing</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#B7791F" }}>{money(totProc, cur)}</div>
          </div>
          <div style={card("#C0392B")}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Failed</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: totFail > 0 ? "#C0392B" : "var(--muted)" }}>{money(totFail, cur)}</div>
          </div>
          <div style={card("var(--blue)")}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Statements</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{rows.length}</div>
          </div>
        </div>
      )}

      {/* ── TỔNG THEO SHOP (khi All shops) ───────────────────────────────── */}
      {loaded && !storeId && byStore.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {byStore.map((s) => (
            <div key={s.name} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "7px 12px", fontSize: 12.5, background: "#FAFBFC" }}>
              <b>{s.name}</b> · <span style={{ color: "#1E8E4E", fontWeight: 700 }}>{money(s.paid, cur)}</span> paid
              {s.proc > 0 && <> · <span style={{ color: "#B7791F", fontWeight: 700 }}>{money(s.proc, cur)}</span> processing</>}
              <span style={{ color: "var(--muted)" }}> · {s.n}</span>
            </div>
          ))}
        </div>
      )}

      {loaded && rows.length > 0 && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={groupDay} onChange={(e) => setGroupDay(e.target.checked)} /> Gộp theo ngày
        </label>
      )}

      <div style={{ overflowX: "auto" }}>
        {groupDay ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase" }}>
                <th style={{ padding: "8px 6px" }}>Day</th>
                <th style={{ padding: "8px 6px" }}>Paid</th>
                <th style={{ padding: "8px 6px" }}>Processing</th>
                <th style={{ padding: "8px 6px" }}>Failed</th>
                <th style={{ padding: "8px 6px" }}>Statements</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((d) => (
                <tr key={d.day} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 6px", fontWeight: 700 }}>{d.day}</td>
                  <td style={{ padding: "8px 6px", color: "#1E8E4E", fontWeight: 700 }}>{money(d.paid, cur)}</td>
                  <td style={{ padding: "8px 6px", color: "#B7791F" }}>{d.proc ? money(d.proc, cur) : "—"}</td>
                  <td style={{ padding: "8px 6px", color: "#C0392B" }}>{d.fail ? money(d.fail, cur) : "—"}</td>
                  <td style={{ padding: "8px 6px", color: "var(--muted)" }}>{d.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase" }}>
                <th style={{ padding: "8px 6px" }}>Statement date</th>
                {!storeId && <th style={{ padding: "8px 6px" }}>Shop</th>}
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
                  <tr key={r.id + (r.storeId ?? "")} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 6px" }}>{fmtDate(r.time)}</td>
                    {!storeId && <td style={{ padding: "8px 6px", fontWeight: 600 }}>{r.storeName ?? "—"}</td>}
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
        )}
        {loaded && !rows.length && <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>No statements in this range.</div>}
        {!loaded && !err && <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>Chọn phạm vi rồi bấm “Load payouts” — để “All shops” là kéo tất cả shop đang gắn API.</div>}
      </div>

      {loaded && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12 }}>
          Lưu ý: số “On hold” trong Seller Center là tiền đơn CHƯA tới kỳ quyết toán — TikTok không mở API cho số này,
          nên ở đây chỉ có statement đã quyết toán (PAID / PROCESSING / FAILED). On hold xem trực tiếp trong Seller Center.
        </div>
      )}
    </div>
  );
}
