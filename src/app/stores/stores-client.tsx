"use client";
import { useCallback, useEffect, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";
import { useConfirm } from "@/components/confirm-provider";
import { useLang } from "@/components/lang-provider";
import { IconSettings, IconTrash, IconLink } from "@/components/icons";

type Store = {
  id: string; name: string; marketplace: string; connectMethod: string; status: string;
  sellerName: string | null; sellerId: string | null; note: string | null; storeUrl: string | null;
  currency: string; fxRate: string; health?: { fxConvertedAt?: string; fxConvertedRate?: number } | null;
  orders30d: number; orders7d: number; revenue30d: number; lastOrderDays: number | null;
  live: boolean; hasCredentials: boolean; credentialKeys: string[];
};
type Opt = { id: string; name: string };

const MKS: [string, string][] = [["tiktok", "TikTok Shop"], ["amazon", "Amazon"], ["etsy", "Etsy"], ["other", "Other"]];
const CONNECT: [string, string][] = [["extension", "Chrome Extension"], ["api", "API"], ["excel", "Excel Import"]];
const CURRENCIES: [string, string][] = [["USD", "USD ($)"], ["VND", "VND (₫)"], ["EUR", "EUR (€)"], ["GBP", "GBP (£)"], ["AUD", "AUD"], ["CAD", "CAD"], ["JPY", "JPY (¥)"]];
const FX_DEFAULT: Record<string, number> = { VND: 25400, EUR: 0.92, GBP: 0.79, AUD: 1.5, CAD: 1.36, JPY: 157 };
const MK_COLOR: Record<string, string> = { tiktok: "#25242A", amazon: "#FF9900", etsy: "#F1641E", other: "#66788E" };
const money = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
// Field credentials theo từng sàn
const CRED_FIELDS: Record<string, [string, string][]> = {
  tiktok: [["app_key", "App Key"], ["app_secret", "App Secret"], ["access_token", "Access Token"], ["shop_id", "Shop ID"]],
  amazon: [["seller_id", "Seller ID"], ["mws_token", "MWS Auth Token"], ["access_key", "Access Key"], ["secret_key", "Secret Key"]],
  etsy: [["api_key", "API Key"], ["shared_secret", "Shared Secret"], ["oauth_token", "OAuth Token"], ["shop_id", "Shop ID"]],
  other: [["endpoint", "Endpoint"], ["token", "Token"]],
};

export function StoresClient({ canAdd, role }: { canAdd: boolean; role: string }) {
  const { t } = useLang();
  const confirm = useConfirm();
  const [stores, setStores] = useState<Store[]>([]);
  const [sellers, setSellers] = useState<Opt[]>([]);
  const [scoped, setScoped] = useState(false);
  const [fSeller, setFSeller] = useState(""); const [fMk, setFMk] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState<Store | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (fSeller) p.set("sellerId", fSeller);
    if (fMk) p.set("marketplace", fMk);
    fetch(`/api/stores?${p}`).then((r) => r.json()).then((j) => { if (j.ok) { setStores(j.stores); setSellers(j.sellers); setScoped(!!j.scoped); } });
  }, [fSeller, fMk]);
  useEffect(() => { load(); }, [load]);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const delStore = async (s: Store) => {
    if (!(await confirm({ message: `Xóa store "${s.name}"? Đơn & design của store sẽ được gỡ liên kết (không xóa), thao tác này không hoàn tác.`, danger: true }))) return;
    const j = await fetch(`/api/stores/${s.id}`, { method: "DELETE" }).then((r) => r.json());
    if (j.ok) { flash(t("st.deletedStore")); load(); } else flash("✗ " + (j.error ?? "Lỗi"));
  };

  const byMk = (mk: string) => stores.filter((s) => s.marketplace === mk);
  const total30 = stores.reduce((a, s) => a + s.revenue30d, 0);

  return (
    <>
      {msg && <div style={{ position: "fixed", top: 16, right: 16, zIndex: 100, background: "#2A303C", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13.5 }}>{msg}</div>}

      {/* Page head */}
      <div className="page-head">
        <div className="page-actions">
          {canAdd && <button onClick={() => setShowAdd(true)} className="btn btn-primary">{t("s.addStore")}</button>}
        </div>
      </div>

      {/* Filter */}
      <div className="card" style={{ padding: "16px 18px", marginBottom: 14 }}>
        <div className="filters">
          {!(scoped && sellers.length <= 1) && (
          <div className="field">
            <label>{t("c.seller")}</label>
            <select value={fSeller} onChange={(e) => setFSeller(e.target.value)}>
              <option value="">Tất cả</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          )}
          <div className="field">
            <label>{t("c.marketplace")}</label>
            <select value={fMk} onChange={(e) => setFMk(e.target.value)}>
              <option value="">Tất cả</option>
              {MKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t("s.totalRev30")}</label>
            <div style={{ padding: "9px 0", fontWeight: 800, fontSize: 16, color: "var(--green)" }}>{money(total30)}</div>
          </div>
        </div>
      </div>

      {/* Cột theo sàn */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
        {MKS.map(([mk, label]) => {
          const list = byMk(mk);
          return (
            <div key={mk} className="card" style={{ padding: 16, borderTop: `3px solid ${MK_COLOR[mk] ?? "#66788E"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <MarketplaceLogo mk={mk} size={26} />
                <b style={{ fontSize: 15 }}>{label}</b>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{list.length}</span>
              </div>
              {list.length === 0 && <div style={{ color: "var(--faint)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>{t("s.empty")}</div>}
              {list.map((s) => (
                <div key={s.id} style={{ border: "1px solid var(--line)", borderLeft: `3px solid ${s.live ? "var(--green)" : "var(--red)"}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10, transition: "border-color .15s" }}
                  onMouseEnter={(e) => { if (canAdd) { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.borderLeftColor = s.live ? "var(--green)" : "var(--red)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.borderLeftColor = s.live ? "var(--green)" : "var(--red)"; }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <b style={{ fontSize: 14 }}>{s.name}</b>
                    {/* Live/Die badge */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999,
                      background: s.live ? "var(--green-soft)" : "var(--red-soft)", color: s.live ? "var(--green)" : "var(--red)" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.live ? "var(--green)" : "var(--red)" }} />
                      {s.live ? t("s.live") : t("s.die")}
                    </span>
                    {canAdd && (
                      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                        {s.storeUrl && <a href={s.storeUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="st-iconbtn" title={t("st.openShop")}><IconLink width={14} height={14} /></a>}
                        <button onClick={() => setEdit(s)} className="st-iconbtn" title={t("st.editStore")}><IconSettings width={15} height={15} /></button>
                        <button onClick={() => delStore(s)} className="st-iconbtn danger" title={t("st.deleteStore")}><IconTrash width={14} height={14} /></button>
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>
                    {s.sellerName ?? "—"} · {CONNECT.find(([k]) => k === s.connectMethod)?.[1] ?? s.connectMethod}
                    {s.connectMethod === "api" && (s.hasCredentials ? ` · 🔑 ${t("st.apiSet")}` : ` · ⚠ ${t("st.noApi")}`)}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <b>{s.orders30d}</b> đơn · <b style={{ color: "var(--green)" }}>{money(s.revenue30d)}</b> <span style={{ color: "var(--muted)" }}>/ 30d</span>
                    {s.orders7d > 0 && <span style={{ color: "var(--muted)", fontSize: 11.5 }}> · {s.orders7d} đơn/7d</span>}
                  </div>
                  {s.lastOrderDays != null && s.lastOrderDays > 7 && (
                    <div style={{ fontSize: 11, color: "var(--red)", marginTop: 3 }}>⚠ {s.lastOrderDays} ngày không có đơn</div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {showAdd && <AddStoreModal sellers={sellers} isSeller={role === "seller"} close={() => setShowAdd(false)} reload={load} flash={flash} />}
      {edit && <EditStoreModal store={edit} sellers={sellers} isSeller={role === "seller"} close={() => setEdit(null)} reload={load} flash={flash} />}
    </>
  );
}

function AddStoreModal({ sellers, isSeller, close, reload, flash }: { sellers: Opt[]; isSeller: boolean; close: () => void; reload: () => void; flash: (m: string) => void }) {
  const { t } = useLang();
  const [f, setF] = useState({ name: "", marketplace: "tiktok", connectMethod: "extension", sellerId: "", note: "", storeUrl: "", currency: "USD", fxRate: "1" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      if (j.ok) { flash(t("st.addedStore")); reload(); close(); return; }
      flash("✗ " + (j.error ?? "Error"));
    } catch (e) { flash("✗ " + (e as Error).message); }
    setBusy(false);
  };
  return (
    <Modal title={t("st.addStoreNew")} close={close}>
      <L label={t("st.storeName")}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="VD: gymwear.us" style={inp} /></L>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <L label={t("st.marketplace")}><select value={f.marketplace} onChange={(e) => setF({ ...f, marketplace: e.target.value })} style={inp}>{MKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
        <L label={t("st.connect")}><select value={f.connectMethod} onChange={(e) => setF({ ...f, connectMethod: e.target.value })} style={inp}>{CONNECT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
      </div>
      {!isSeller && <L label={t("st.seller")}><select value={f.sellerId} onChange={(e) => setF({ ...f, sellerId: e.target.value })} style={inp}><option value="">—</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></L>}
      <L label={t("st.linkShop")}><input value={f.storeUrl} onChange={(e) => setF({ ...f, storeUrl: e.target.value })} placeholder="https://shop.tiktok.com/@yourshop" style={inp} /></L>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <L label="Tiền tệ shop"><select value={f.currency} onChange={(e) => { const cur = e.target.value; setF({ ...f, currency: cur, fxRate: cur === "USD" ? "1" : (f.fxRate === "1" ? String(FX_DEFAULT[cur] ?? "") : f.fxRate) }); }} style={inp}>{CURRENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
        <L label={`Tỉ giá: 1 USD = ? ${f.currency}`}><input type="number" step="0.0001" value={f.fxRate} disabled={f.currency === "USD"} onChange={(e) => setF({ ...f, fxRate: e.target.value })} placeholder="vd 25400" style={{ ...inp, background: f.currency === "USD" ? "#EDEFF4" : "#fff" }} /></L>
      </div>
      <L label={t("st.note")}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={inp} /></L>
      <Actions close={close} onOk={submit} busy={busy} okLabel={t("st.addStore")} disabled={!f.name.trim()} />
    </Modal>
  );
}

function EditStoreModal({ store, sellers, isSeller, close, reload, flash }: { store: Store; sellers: Opt[]; isSeller: boolean; close: () => void; reload: () => void; flash: (m: string) => void }) {
  const { t } = useLang();
  const [f, setF] = useState({ name: store.name, sellerId: store.sellerId ?? "", status: store.status, connectMethod: store.connectMethod, note: store.note ?? "", storeUrl: store.storeUrl ?? "", currency: store.currency ?? "USD", fxRate: store.fxRate ?? "1" });
  const [cred, setCred] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const fields = CRED_FIELDS[store.marketplace] ?? CRED_FIELDS.other;

  const save = async () => {
    setBusy(true);
    const body: Record<string, unknown> = { ...f };
    if (Object.keys(cred).length) body.credentials = cred;
    try {
      const r = await fetch(`/api/stores/${store.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      if (j.ok) { flash(t("st.savedStore")); reload(); close(); return; }
      flash("✗ " + (j.error ?? "Error"));
    } catch (e) { flash("✗ " + (e as Error).message); }
    setBusy(false);
  };
  const check = async () => {
    setBusy(true);
    const j = await fetch(`/api/stores/${store.id}`, { method: "POST" }).then((r) => r.json());
    setBusy(false);
    if (j.ok) setHealth(j.health);
  };
  async function fxConvert() {
    const rate = Number(store.fxRate);
    if (!(rate > 1)) { flash("Nhập tỉ giá > 1 rồi bấm Lưu store TRƯỚC, sau đó mới quy đổi."); return; }
    const already = store.health?.fxConvertedAt;
    const warn = `Chia total + đơn giá của TẤT CẢ đơn shop "${store.name}" cho ${rate} (→ USD)?\n\nCHỈ chạy 1 LẦN cho các đơn đã import trước khi bật tỉ giá.${already ? `\n\n⚠ ĐÃ quy đổi lúc ${new Date(already).toLocaleString()} — chạy lại sẽ chia SAI!` : ""}`;
    if (!window.confirm(warn)) return;
    setBusy(true);
    const j = await fetch(`/api/stores/${store.id}/fx-convert`, { method: "POST" }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) { flash(`✓ Đã quy đổi ${j.orders} đơn (÷${j.rate})`); reload(); close(); }
    else flash("✗ " + (j.error ?? "lỗi"));
  }

  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><MarketplaceLogo mk={store.marketplace} size={22} /> {store.name}</span>} close={close}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <L label={t("st.storeName")}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={inp} /></L>
        <L label={t("st.status")}><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} style={inp}><option value="active">Active</option><option value="warning">Warning</option><option value="suspended">Suspended</option><option value="pending">Pending</option></select></L>
        {!isSeller && <L label="Seller"><select value={f.sellerId} onChange={(e) => setF({ ...f, sellerId: e.target.value })} style={inp}><option value="">—</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></L>}
        <L label={t("st.connect")}><select value={f.connectMethod} onChange={(e) => setF({ ...f, connectMethod: e.target.value })} style={inp}>{CONNECT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
      </div>
      <L label={t("st.linkShop")}><input value={f.storeUrl} onChange={(e) => setF({ ...f, storeUrl: e.target.value })} placeholder="https://shop.tiktok.com/@yourshop" style={inp} /></L>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <L label="Tiền tệ shop"><select value={f.currency} onChange={(e) => { const cur = e.target.value; setF({ ...f, currency: cur, fxRate: cur === "USD" ? "1" : (Number(f.fxRate) <= 1 ? String(FX_DEFAULT[cur] ?? "") : f.fxRate) }); }} style={inp}>{CURRENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
        <L label={`Tỉ giá: 1 USD = ? ${f.currency}`}><input type="number" step="0.0001" value={f.fxRate} disabled={f.currency === "USD"} onChange={(e) => setF({ ...f, fxRate: e.target.value })} placeholder="vd 25400" style={{ ...inp, background: f.currency === "USD" ? "#EDEFF4" : "#fff" }} /></L>
      </div>
      {f.currency !== "USD" && (
        <div style={{ border: "1px solid #F3D08A", background: "#FFF9EC", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={fxConvert} disabled={busy} style={{ ...btnGhost, color: "#9A6B00", borderColor: "#F3D08A", fontWeight: 700, fontSize: 12.5 }}>⤵ Quy đổi đơn đã import (÷ tỉ giá)</button>
          <span style={{ fontSize: 11.5, color: "var(--muted)", flex: 1 }}>
            {store.health?.fxConvertedAt
              ? `✓ Đã quy đổi lúc ${new Date(store.health.fxConvertedAt).toLocaleString()} (÷${store.health.fxConvertedRate}). Đừng chạy lại.`
              : "Chạy 1 LẦN cho đơn đã import trước đó. Nhớ bấm Lưu (lưu tỉ giá) trước khi quy đổi."}
          </span>
        </div>
      )}
      <L label={t("st.note")}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={inp} /></L>

      {/* Setup API */}
      {f.connectMethod === "api" && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <b style={{ fontSize: 13.5 }}>Cấu hình API</b>
            {store.hasCredentials && <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 700 }}>`🔑 ${t("st.apiHas")}:` {store.credentialKeys.join(", ")}</span>}
            <button onClick={check} disabled={busy} style={{ ...btnGhost, marginLeft: "auto", fontSize: 12 }}>Check kết nối</button>
          </div>
          {health && (
            <div style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, marginBottom: 8, background: health.ok ? "var(--green-soft)" : "var(--red-soft)", color: health.ok ? "var(--green)" : "var(--red)" }}>
              {health.ok ? "✓" : "✗"} {health.message}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {fields.map(([k, label]) => (
              <L key={k} label={label}>
                <input type="password" placeholder={store.credentialKeys.includes(k) ? t("st.savedKept") : t("st.enterValue")}
                  onChange={(e) => setCred({ ...cred, [k]: e.target.value })} style={inp} autoComplete="off" />
              </L>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Credentials được mã hoá lưu server, không bao giờ hiển thị lại. Để trống field = giữ giá trị cũ.</div>
        </div>
      )}
      <Actions close={close} onOk={save} busy={busy} okLabel={t("st.saveStore")} />
    </Modal>
  );
}

function Modal({ title, close, children }: { title: React.ReactNode; close: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(42,48,60,.45)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={close}>
      <div style={{ background: "#fff", borderRadius: 16, width: 560, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <b style={{ fontSize: 15 }}>{title}</b>
          <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block", marginBottom: 12 }}><span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 5 }}>{label}</span>{children}</label>;
}
function Actions({ close, onOk, busy, okLabel, disabled }: { close: () => void; onOk: () => void; busy: boolean; okLabel: string; disabled?: boolean }) {
  const { t } = useLang();
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
      <button onClick={close} style={btnGhost}>{t("c.cancel")}</button>
      <button onClick={onOk} disabled={busy || disabled} className="btn btn-primary" style={{ opacity: busy || disabled ? 0.6 : 1 }}>{busy ? t("st.saving") : okLabel}</button>
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, fontSize: 13, background: "#fff" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
