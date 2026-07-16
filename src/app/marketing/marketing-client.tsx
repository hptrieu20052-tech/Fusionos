"use client";
import { useEffect, useMemo, useState } from "react";
import DateRangePicker, { rangeToDates, type RangeValue } from "@/components/date-range";
import { useConfirm } from "@/components/confirm-provider";

type Store = { id: string; name: string; sellerId: string | null };
type Seller = { id: string; name: string | null };
type Activity = { id: string; title: string; activityType: string; durationType: string; beginTime: number; endTime: number; status: string; productLevel: string; createTime: number };
type Prod = { id: string; title: string | null; image: string | null; price: string | null };
type PromoType = "FLASHSALE" | "DIRECT_DISCOUNT" | "FIXED_PRICE" | "SHIPPING_DISCOUNT";

const TYPE_META: Record<PromoType, { label: string; hint: string; color: string }> = {
  FLASHSALE: { label: "Flash Sale", hint: "Time-boxed deal price", color: "#C0392B" },
  DIRECT_DISCOUNT: { label: "Direct Discount", hint: "% off each product", color: "#2E7D46" },
  FIXED_PRICE: { label: "Fixed Price", hint: "Set a fixed sale price", color: "#3B6BE5" },
  SHIPPING_DISCOUNT: { label: "Shipping Discount", hint: "Free / reduced shipping", color: "#8E44AD" },
};
const sel: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13, background: "#fff" };
const inp: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13, width: "100%" };

const fmt = (t: number) => (t ? new Date(t * 1000).toLocaleDateString() : "—");
const statusColor = (s: string) => s === "ONGOING" ? { bg: "#E7F6EC", fg: "#1E8E4E" }
  : s === "NOT_START" || s === "DRAFT" ? { bg: "#FFF6E5", fg: "#B7791F" }
  : s === "EXPIRED" || s === "DEACTIVATED" || s === "NOT_EFFECTIVE" ? { bg: "#FDECEC", fg: "#C0392B" }
  : { bg: "#EEF1F5", fg: "#5B6472" };

// ISO date (YYYY-MM-DD) → unix giây (đầu/cuối ngày, giờ local).
const toUnix = (iso: string, endOfDay: boolean) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(new Date(y, (m || 1) - 1, d || 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0).getTime() / 1000);
};

export default function MarketingClient({ stores, sellers = [], canManage }: { stores: Store[]; sellers?: Seller[]; canManage: boolean }) {
  const confirm = useConfirm();
  const [seller, setSeller] = useState("");
  const shopOptions = useMemo(() => (seller ? stores.filter((s) => s.sellerId === seller) : stores), [stores, seller]);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const [acts, setActs] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!storeId) return;
    setLoading(true); setErr("");
    const qs = new URLSearchParams({ storeId }); if (status) qs.set("status", status);
    try {
      const j = await fetch(`/api/tiktok/promotions/list?${qs}`).then((r) => r.json());
      if (j.ok) setActs(j.activities); else setErr(j.error || "Failed to load");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setLoading(false);
  };
  useEffect(() => { if (storeId) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [storeId, status]);

  const deactivate = async (a: Activity) => {
    if (!(await confirm({ message: `Deactivate promotion "${a.title}"? Buyers will no longer see it.`, danger: true }))) return;
    setMsg(`Deactivating "${a.title}"…`);
    const j = await fetch("/api/tiktok/promotions/deactivate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, activityId: a.id }) }).then((r) => r.json());
    if (j.ok) { setMsg(`✓ Deactivated "${a.title}"`); load(); } else setMsg("✗ " + (j.error ?? "failed"));
  };

  const scopeHint = err.includes("40006") || err.toLowerCase().includes("scope") || err.includes("denied") || err.includes("105005");

  if (!stores.length) return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Marketing · TikTok</h2><p style={{ color: "var(--muted)" }}>No TikTok store connected.</p></div>;

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Marketing · TikTok <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>Promotions</span></h2>
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
          <option value="ONGOING">Ongoing</option>
          <option value="NOT_START">Not started</option>
          <option value="DRAFT">Draft</option>
          <option value="EXPIRED">Expired</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>
        <button onClick={load} disabled={loading || !storeId} style={{ ...sel, cursor: loading || !storeId ? "default" : "pointer", fontWeight: 700 }}>{loading ? "Loading…" : "↻ Refresh"}</button>
        {canManage && <button onClick={() => setCreating((v) => !v)} disabled={!storeId} style={{ ...sel, cursor: !storeId ? "default" : "pointer", fontWeight: 800, background: "var(--blue)", color: "#fff", border: 0, opacity: !storeId ? 0.6 : 1 }}>{creating ? "Close" : "+ Create promotion"}</button>}
      </div>

      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>✗ {err}{scopeHint && " — this needs the seller.promotion scope. Add it in Partner Center and re-authorize the shop."}</div>}
      {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("✗") ? "var(--red)" : "var(--muted)", marginBottom: 10 }}>{msg}</div>}

      {creating && canManage && <CreatePromo storeId={storeId} onDone={() => { setCreating(false); load(); }} setMsg={setMsg} />}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase" }}>
              <th style={{ padding: "8px 6px" }}>Title</th>
              <th style={{ padding: "8px 6px" }}>Type</th>
              <th style={{ padding: "8px 6px" }}>Level</th>
              <th style={{ padding: "8px 6px" }}>Start</th>
              <th style={{ padding: "8px 6px" }}>End</th>
              <th style={{ padding: "8px 6px" }}>Status</th>
              {canManage && <th style={{ padding: "8px 6px" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {acts.map((a) => {
              const sc = statusColor(a.status);
              const tm = TYPE_META[a.activityType as PromoType];
              const canOff = ["ONGOING", "NOT_START", "DRAFT"].includes(a.status);
              return (
                <tr key={a.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 6px", fontWeight: 600, maxWidth: 320 }}>{a.title}</td>
                  <td style={{ padding: "8px 6px" }}><span style={{ background: (tm?.color ?? "#5B6472") + "18", color: tm?.color ?? "#5B6472", fontWeight: 700, fontSize: 11, borderRadius: 6, padding: "2px 8px" }}>{tm?.label ?? a.activityType}</span></td>
                  <td style={{ padding: "8px 6px", color: "var(--muted)" }}>{a.productLevel}</td>
                  <td style={{ padding: "8px 6px" }}>{a.durationType === "INDEFINITE" ? "—" : fmt(a.beginTime)}</td>
                  <td style={{ padding: "8px 6px" }}>{a.durationType === "INDEFINITE" ? "No end" : fmt(a.endTime)}</td>
                  <td style={{ padding: "8px 6px" }}><span style={{ background: sc.bg, color: sc.fg, fontWeight: 700, fontSize: 11, borderRadius: 6, padding: "2px 8px" }}>{a.status}</span></td>
                  {canManage && <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                    {canOff ? <button type="button" onClick={() => deactivate(a)} style={{ fontSize: 12, fontWeight: 700, color: "#C0392B", background: "none", border: 0, cursor: "pointer", padding: 0 }}>Deactivate</button> : <span style={{ color: "var(--faint)", fontSize: 12 }}>—</span>}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !acts.length && !err && <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>No promotions for this shop yet.</div>}
      </div>
    </div>
  );
}

// ===== Create promotion form =====
function CreatePromo({ storeId, onDone, setMsg }: { storeId: string; onDone: () => void; setMsg: (m: string) => void }) {
  const [type, setType] = useState<PromoType>("DIRECT_DISCOUNT");
  const [title, setTitle] = useState("");
  const [dr, setDr] = useState<RangeValue>({ range: "custom" });
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState("");

  // Shipping
  const [shopLevel, setShopLevel] = useState(true); // true = whole shop
  const [benefit, setBenefit] = useState<"FREE_SHIPPING" | "DISCOUNT_SHIPPING_FEE">("FREE_SHIPPING");
  const [shipValue, setShipValue] = useState("");
  const [thrType, setThrType] = useState<"NO_THRESHOLD" | "MINIMAL_ORDER_AMOUNT" | "MINIMAL_ITEM_QUANTITY">("NO_THRESHOLD");
  const [thrValue, setThrValue] = useState("");

  // Product picker
  const [prods, setProds] = useState<Prod[]>([]);
  const [pkw, setPkw] = useState("");
  const [ploading, setPloading] = useState(false);
  const [pick, setPick] = useState<Record<string, { dealPrice: string; discount: string }>>({});
  const [bulk, setBulk] = useState("");

  const isShipping = type === "SHIPPING_DISCOUNT";
  const needProducts = !(isShipping && shopLevel);
  const isPriceType = type === "FIXED_PRICE" || type === "FLASHSALE";

  const loadProds = async () => {
    setPloading(true);
    const qs = new URLSearchParams({ storeId }); if (pkw.trim()) qs.set("kw", pkw.trim());
    const j = await fetch(`/api/tiktok/promotions/products?${qs}`).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) setProds(j.products); setPloading(false);
  };
  useEffect(() => { if (needProducts && storeId) loadProds(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [storeId, needProducts]);

  const toggle = (id: string) => setPick((p) => { const n = { ...p }; if (n[id]) delete n[id]; else n[id] = { dealPrice: "", discount: "" }; return n; });
  const setField = (id: string, k: "dealPrice" | "discount", v: string) => setPick((p) => ({ ...p, [id]: { ...(p[id] ?? { dealPrice: "", discount: "" }), [k]: v } }));
  const applyBulk = () => { if (!bulk) return; setPick((p) => { const n = { ...p }; for (const id of Object.keys(n)) n[id] = isPriceType ? { ...n[id], dealPrice: bulk } : { ...n[id], discount: bulk }; return n; }); };

  const submit = async () => {
    setLocalErr("");
    if (!title.trim()) return setLocalErr("Enter a title.");
    const { from, to } = rangeToDates(dr);
    if (!from || !to) return setLocalErr("Pick the schedule (start & end date).");
    const nowSec = Math.floor(Date.now() / 1000);
    const beginTime = Math.max(toUnix(from, false), nowSec + 600); // nếu bắt đầu hôm nay → +10 phút cho hợp lệ
    const endTime = toUnix(to, true);
    if (endTime <= beginTime) return setLocalErr("End date must be after the start date.");

    const items = needProducts ? Object.entries(pick).map(([productId, v]) => ({ productId, dealPrice: v.dealPrice, discount: v.discount })) : [];
    if (needProducts && !items.length) return setLocalErr("Select at least one product.");
    if (needProducts && type === "DIRECT_DISCOUNT" && items.some((i) => !i.discount || Number(i.discount) <= 0)) return setLocalErr("Enter a discount % for every selected product.");
    if (needProducts && isPriceType && items.some((i) => !i.dealPrice || Number(i.dealPrice) <= 0)) return setLocalErr("Enter a deal price for every selected product.");
    if (isShipping && benefit === "DISCOUNT_SHIPPING_FEE" && (!shipValue || Number(shipValue) <= 0)) return setLocalErr("Enter the shipping discount amount.");

    const body: Record<string, unknown> = { storeId, title: title.trim(), activityType: type, beginTime, endTime, durationType: "NORMAL" };
    if (isShipping) {
      body.productLevel = shopLevel ? "SHOP" : "PRODUCT";
      body.shipping = { benefit, value: shipValue, thresholdType: shopLevel ? thrType : "NO_THRESHOLD", thresholdValue: thrValue };
      if (!shopLevel) body.items = items;
    } else {
      body.items = items;
    }

    setBusy(true); setMsg(`Creating "${title.trim()}"…`);
    const j = await fetch("/api/tiktok/promotions/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (j.ok) { setMsg(`✓ Created "${title.trim()}" (${j.status ?? "DRAFT"})${j.attached ? ` · ${j.attached} product(s)` : ""}`); onDone(); }
    else setLocalErr(j.error ?? "Create failed");
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 16, marginBottom: 16, background: "#FBFCFE" }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>New promotion</div>

      {/* Type chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {(Object.keys(TYPE_META) as PromoType[]).map((k) => {
          const m = TYPE_META[k]; const on = type === k;
          return (
            <button key={k} type="button" onClick={() => setType(k)} style={{ textAlign: "left", border: on ? `1.5px solid ${m.color}` : "1px solid var(--line)", background: on ? m.color + "10" : "#fff", borderRadius: 11, padding: "8px 12px", cursor: "pointer", minWidth: 150 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: on ? m.color : "var(--ink)" }}>{m.label}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.hint}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Title (max 50)</label>
          <input value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Summer Flash Sale" style={inp} />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Schedule (start → end)</label>
          <div><DateRangePicker value={dr} onChange={setDr} allowFuture /></div>
        </div>
      </div>

      {/* Shipping options */}
      {isShipping && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12, padding: 12, border: "1px dashed var(--line)", borderRadius: 10 }}>
          <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={shopLevel} onChange={(e) => setShopLevel(e.target.checked)} /> Whole shop</label>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Benefit</label>
            <select value={benefit} onChange={(e) => setBenefit(e.target.value as "FREE_SHIPPING" | "DISCOUNT_SHIPPING_FEE")} style={{ ...inp }}>
              <option value="FREE_SHIPPING">Free shipping</option>
              <option value="DISCOUNT_SHIPPING_FEE">Discount shipping fee</option>
            </select>
          </div>
          {benefit === "DISCOUNT_SHIPPING_FEE" && (
            <div><label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Max discount amount</label><input value={shipValue} onChange={(e) => setShipValue(e.target.value)} placeholder="e.g. 5.00" style={inp} /></div>
          )}
          {shopLevel && (
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Minimum spend</label>
              <select value={thrType} onChange={(e) => setThrType(e.target.value as typeof thrType)} style={inp}>
                <option value="NO_THRESHOLD">No minimum</option>
                <option value="MINIMAL_ORDER_AMOUNT">Min order amount</option>
                <option value="MINIMAL_ITEM_QUANTITY">Min item quantity</option>
              </select>
            </div>
          )}
          {shopLevel && thrType !== "NO_THRESHOLD" && (
            <div><label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Threshold value</label><input value={thrValue} onChange={(e) => setThrValue(e.target.value)} placeholder={thrType === "MINIMAL_ORDER_AMOUNT" ? "e.g. 25.00" : "e.g. 3"} style={inp} /></div>
          )}
        </div>
      )}

      {/* Product picker */}
      {needProducts && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: 12.5 }}>Products <span style={{ color: "var(--muted)", fontWeight: 500 }}>({Object.keys(pick).length} selected)</span></b>
            <input value={pkw} onChange={(e) => setPkw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadProds()} placeholder="Search title / id" style={{ ...sel, minWidth: 180 }} />
            <button type="button" onClick={loadProds} style={{ ...sel, cursor: "pointer", fontWeight: 700 }}>Search</button>
            {Object.keys(pick).length > 0 && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
                <input value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={isPriceType ? "Set price for all" : "Set % for all"} style={{ ...sel, width: 150 }} />
                <button type="button" onClick={applyBulk} style={{ ...sel, cursor: "pointer", fontWeight: 700 }}>Apply</button>
              </div>
            )}
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10 }}>
            {ploading ? <div style={{ padding: 16, color: "var(--muted)", fontSize: 12.5 }}>Loading products…</div>
              : !prods.length ? <div style={{ padding: 16, color: "var(--muted)", fontSize: 12.5 }}>No active products found. Sync products first.</div>
              : prods.map((p) => {
                const on = !!pick[p.id];
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderTop: "1px solid var(--line)", background: on ? "#EEF5FF" : "transparent" }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.image ? <img src={p.image} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6 }} /> : <div style={{ width: 34, height: 34, borderRadius: 6, background: "#EEF1F5" }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title || "(no title)"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>ID: {p.id}{p.price ? ` · $${Number(p.price).toFixed(2)}` : ""}</div>
                    </div>
                    {on && !isShipping && (
                      isPriceType
                        ? <input value={pick[p.id].dealPrice} onChange={(e) => setField(p.id, "dealPrice", e.target.value)} placeholder="Deal $" style={{ ...sel, width: 90 }} />
                        : <div style={{ display: "flex", alignItems: "center", gap: 4 }}><input value={pick[p.id].discount} onChange={(e) => setField(p.id, "discount", e.target.value)} placeholder="off" style={{ ...sel, width: 64 }} /><span style={{ fontSize: 12, color: "var(--muted)" }}>%</span></div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {localErr && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>✗ {localErr}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onDone} style={{ ...sel, cursor: "pointer", fontWeight: 700 }}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={{ ...sel, cursor: busy ? "wait" : "pointer", fontWeight: 800, background: "var(--blue)", color: "#fff", border: 0, opacity: busy ? 0.6 : 1 }}>{busy ? "Creating…" : "Create promotion"}</button>
      </div>
    </div>
  );
}
