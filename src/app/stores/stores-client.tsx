"use client";
import { useCallback, useEffect, useState } from "react";
import { Flash } from "@/components/flash";
import { MarketplaceLogo } from "@/components/marketplace-logo";
import { useConfirm } from "@/components/confirm-provider";
import { useLang } from "@/components/lang-provider";
import { IconSettings, IconTrash, IconLink, IconPuzzle, IconRefresh, IconKey, IconDownload, IconWarn, IconCopy } from "@/components/icons";

type Store = {
  id: string; name: string; marketplace: string; connectMethod: string; status: string;
  sellerName: string | null; sellerId: string | null; note: string | null; storeUrl: string | null;
  currency: string; fxRate: string; ingestToken?: string | null; health?: { fxConvertedAt?: string; fxConvertedRate?: number } | null;
  orders30d: number; orders7d: number; revenue30d: number; lastOrderDays: number | null;
  live: boolean; hasCredentials: boolean; credentialKeys: string[];
  etsy?: { hasKeystring: boolean; keystring: string; connected: boolean; shopId: string };
  tiktok?: { hasApp: boolean; appKey: string; authLink: string; connected: boolean; shopId: string; shopName: string };
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
  // Kết quả OAuth Etsy chuyển hướng về ?etsy=ok/err&msg=...
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const e = q.get("etsy");
    if (e) {
      setMsg((e === "ok" ? "✓ " : "✗ ") + (q.get("msg") || ""));
      setTimeout(() => setMsg(""), 4000);
      window.history.replaceState({}, "", "/stores");
    }
  }, []);

  const delStore = async (s: Store) => {
    if (!(await confirm({ message: t("st.deleteConfirm").replace("{name}", s.name), danger: true }))) return;
    const j = await fetch(`/api/stores/${s.id}`, { method: "DELETE" }).then((r) => r.json());
    if (j.ok) { flash(t("st.deletedStore")); load(); } else flash("✗ " + (j.error ?? t("st.error")));
  };

  const byMk = (mk: string) => stores.filter((s) => s.marketplace === mk);
  const total30 = stores.reduce((a, s) => a + s.revenue30d, 0);

  return (
    <>
      <Flash msg={msg} />

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
              <option value="">All</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          )}
          <div className="field">
            <label>{t("c.marketplace")}</label>
            <select value={fMk} onChange={(e) => setFMk(e.target.value)}>
              <option value="">All</option>
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
                    {s.connectMethod === "api" && (s.hasCredentials ? <> · <IconKey width={11} height={11} style={{ verticalAlign: "-1px" }} /> {t("st.apiSet")}</> : <> · <IconWarn width={11} height={11} style={{ verticalAlign: "-1px" }} /> {t("st.noApi")}</>)}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <b>{s.orders30d}</b> orders · <b style={{ color: "var(--green)" }}>{money(s.revenue30d)}</b> <span style={{ color: "var(--muted)" }}>/ 30d</span>
                    {s.orders7d > 0 && <span style={{ color: "var(--muted)", fontSize: 11.5 }}> · {s.orders7d} orders/7d</span>}
                  </div>
                  {s.lastOrderDays != null && s.lastOrderDays > 7 && (
                    <div style={{ fontSize: 11, color: "var(--red)", marginTop: 3 }}>⚠ {s.lastOrderDays} days without orders</div>
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
      <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <L label={t("st.marketplace")}><select value={f.marketplace} onChange={(e) => setF({ ...f, marketplace: e.target.value })} style={inp}>{MKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
      </div>
      {!isSeller && <L label={t("st.seller")}><select value={f.sellerId} onChange={(e) => setF({ ...f, sellerId: e.target.value })} style={inp}><option value="">—</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></L>}
      <L label={t("st.linkShop")}><input value={f.storeUrl} onChange={(e) => setF({ ...f, storeUrl: e.target.value })} placeholder="https://shop.tiktok.com/@yourshop" style={inp} /></L>
      {f.marketplace === "etsy" && (
        <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--blue-soft)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", margin: "2px 0 4px", lineHeight: 1.55 }}>
          New Etsy shops (0–100 sales) usually can&apos;t get an API key yet — pull orders with the{" "}
          <a href="/extension/" target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>FUSION Order Sync extension</a>{" "}
          instead. Once the shop has its own Etsy API approved, hit Connect Etsy and orders switch to the official API.
        </div>
      )}
      <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <L label={t("st.shopCurrency")}><select value={f.currency} onChange={(e) => { const cur = e.target.value; setF({ ...f, currency: cur, fxRate: cur === "USD" ? "1" : (f.fxRate === "1" ? String(FX_DEFAULT[cur] ?? "") : f.fxRate) }); }} style={inp}>{CURRENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
        <L label={t("st.fxLabel").replace("{cur}", f.currency)}><input type="number" step="0.0001" value={f.fxRate} disabled={f.currency === "USD"} onChange={(e) => setF({ ...f, fxRate: e.target.value })} placeholder="vd 25400" style={{ ...inp, background: f.currency === "USD" ? "#EDEFF4" : "#fff" }} /></L>
      </div>
      <L label={t("st.note")}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={inp} /></L>
      <Actions close={close} onOk={submit} busy={busy} okLabel={t("st.addStore")} disabled={!f.name.trim()} />
    </Modal>
  );
}

function EditStoreModal({ store, sellers, isSeller, close, reload, flash }: { store: Store; sellers: Opt[]; isSeller: boolean; close: () => void; reload: () => void; flash: (m: string) => void }) {
  const { t } = useLang();
  const confirm = useConfirm();
  const [f, setF] = useState({ name: store.name, sellerId: store.sellerId ?? "", status: store.status, connectMethod: store.connectMethod, note: store.note ?? "", storeUrl: store.storeUrl ?? "", currency: store.currency ?? "USD", fxRate: store.fxRate ?? "1" });
  const [cred, setCred] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const [tok, setTok] = useState(store.ingestToken ?? "");
  const [showTok, setShowTok] = useState(false);
  const regenToken = async () => {
    if (!(await confirm({ title: t("st.newToken"), message: t("st.newTokenConfirm"), danger: true, confirmText: t("st.create") }))) return;
    const j = await fetch(`/api/stores/${store.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ regenIngestToken: true }) }).then((r) => r.json());
    if (j.ok && j.ingestToken) { setTok(j.ingestToken); flash(t("st.tokenCreated")); } else flash(t("st.tokenErr"));
  };
  const ingestUrl = typeof window !== "undefined" ? `${window.location.origin}/api/ingest/etsy` : "/api/ingest/etsy";
  // Domain CHUẨN cho callback — không dùng window.origin vì mở qua *.vercel.app sẽ hiện sai URL đăng ký
  const CANONICAL = "https://os.fusiondn.com";
  const oauthCb = `${CANONICAL}/api/etsy/oauth/callback`;
  const [etsyKey, setEtsyKey] = useState(store.etsy?.keystring ?? "");
  const [etsySecret, setEtsySecret] = useState("");
  const [etsyBusy, setEtsyBusy] = useState(false);
  const [etsySaved, setEtsySaved] = useState(false);
  const [roEtsy, setRoEtsy] = useState(true); // readonly lúc mở để chặn Chrome autofill, bỏ khi focus
  const saveEtsyApi = async () => {
    if (!etsyKey.trim() || !etsySecret.trim()) { flash("✗ Enter Keystring + Shared Secret"); return; }
    setEtsyBusy(true);
    const j = await fetch("/api/etsy/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: store.id, keystring: etsyKey.trim(), sharedSecret: etsySecret.trim() }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setEtsyBusy(false);
    if (j.ok) { flash("✓ Etsy app saved — now click Connect Etsy"); setEtsySaved(true); reload(); } else flash("✗ " + (j.error ?? "Error"));
  };
  const connectEtsy = () => { window.location.href = `/api/etsy/oauth/start?storeId=${store.id}`; };
  // ===== TikTok Shop API =====
  const [ttKey, setTtKey] = useState(store.tiktok?.appKey ?? "");
  const [ttSecret, setTtSecret] = useState("");
  const [ttAuthLink, setTtAuthLink] = useState(store.tiktok?.authLink ?? "");
  const [ttBusy, setTtBusy] = useState(false);
  const [ttSaved, setTtSaved] = useState(false); // Connect sáng ngay sau Save app, khỏi mở lại modal
  const saveTtApi = async () => {
    if (!ttKey.trim() || !ttSecret.trim()) { flash("✗ Enter App Key + App Secret"); return; }
    setTtBusy(true);
    const j = await fetch("/api/tiktok/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: store.id, appKey: ttKey.trim(), appSecret: ttSecret.trim(), authLink: ttAuthLink.trim() }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setTtBusy(false);
    if (j.ok) { flash("✓ TikTok app saved — now click Connect TikTok"); setTtSaved(true); reload(); } else flash("✗ " + (j.error ?? "Error"));
  };
  const connectTt = () => { window.location.href = `/api/tiktok/oauth/start?storeId=${store.id}`; };
  // Link authorize tĩnh (TikTok không PKCE) → copy dán vào browser AdsPower của shop là đúng bài
  const ttConnectLink = () => {
    const base = ttAuthLink.trim() || store.tiktok?.authLink || "";
    if (!base) { flash("✗ Save the Authorization link first"); return; }
    const link = `${base}${base.includes("?") ? "&" : "?"}state=${store.id}`;
    navigator.clipboard?.writeText(link);
    flash("✓ Connect link copied — paste it into the shop's AdsPower browser and Authorize");
  };
  const checkTt = async () => {
    setTtBusy(true);
    const j = await fetch("/api/tiktok/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: store.id }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setTtBusy(false);
    if (j.ok) flash(`✓ Connection OK — ${(j.shops ?? []).map((x: { name: string }) => x.name).join(", ") || "authorized"}`);
    else flash("✗ " + (j.error ?? "Error"));
  };
  const pullEtsy = async () => {
    setEtsyBusy(true);
    const j = await fetch("/api/etsy/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: store.id }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setEtsyBusy(false);
    if (j.ok) { flash(`✓ ${j.received} orders — created ${j.created}, skipped ${j.skipped}`); reload(); } else flash("✗ " + (j.error ?? "Error"));
  };
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
    if (!(rate > 1)) { flash(t("st.fxNeedRate")); return; }
    const already = store.health?.fxConvertedAt;
    const warn = t("st.fxConfirmBody").replace("{name}", store.name).replace("{rate}", String(rate)) + (already ? t("st.fxConfirmRedo").replace("{time}", new Date(already).toLocaleString()) : "");
    if (!(await confirm({ title: t("st.fxConvertTitle"), message: warn, danger: true, confirmText: t("st.fxConvert"), cancelText: t("c.cancel") }))) return;
    setBusy(true);
    const j = await fetch(`/api/stores/${store.id}/fx-convert`, { method: "POST" }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) { flash(t("st.fxConverted").replace("{n}", String(j.orders)).replace("{rate}", String(j.rate))); reload(); close(); }
    else flash("✗ " + (j.error ?? t("st.error")));
  }

  return (
    <Modal title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><MarketplaceLogo mk={store.marketplace} size={22} /> {store.name}</span>} close={close}>
      <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <L label={t("st.storeName")}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={inp} /></L>
        <L label={t("st.status")}><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} style={inp}><option value="active">Active</option><option value="warning">Warning</option><option value="suspended">Suspended</option><option value="pending">Pending</option></select></L>
        {!isSeller && <L label="Seller"><select value={f.sellerId} onChange={(e) => setF({ ...f, sellerId: e.target.value })} style={inp}><option value="">—</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></L>}
      </div>
      <L label={t("st.linkShop")}><input value={f.storeUrl} onChange={(e) => setF({ ...f, storeUrl: e.target.value })} placeholder="https://shop.tiktok.com/@yourshop" style={inp} /></L>
      <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <L label={t("st.shopCurrency")}><select value={f.currency} onChange={(e) => { const cur = e.target.value; setF({ ...f, currency: cur, fxRate: cur === "USD" ? "1" : (Number(f.fxRate) <= 1 ? String(FX_DEFAULT[cur] ?? "") : f.fxRate) }); }} style={inp}>{CURRENCIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></L>
        <L label={t("st.fxLabel").replace("{cur}", f.currency)}><input type="number" step="0.0001" value={f.fxRate} disabled={f.currency === "USD"} onChange={(e) => setF({ ...f, fxRate: e.target.value })} placeholder="vd 25400" style={{ ...inp, background: f.currency === "USD" ? "#EDEFF4" : "#fff" }} /></L>
      </div>
      {f.currency !== "USD" && (
        <div style={{ border: "1px solid #F3D08A", background: "#FFF9EC", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={fxConvert} disabled={busy} style={{ ...btnGhost, color: "#9A6B00", borderColor: "#F3D08A", fontWeight: 700, fontSize: 12.5 }}><IconDownload width={12} height={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("st.fxConvertImported")}</button>
          <span style={{ fontSize: 11.5, color: "var(--muted)", flex: 1 }}>
            {store.health?.fxConvertedAt
              ? t("st.fxDoneAt").replace("{time}", new Date(store.health.fxConvertedAt).toLocaleString()).replace("{rate}", String(store.health.fxConvertedRate))
              : t("st.fxHint")}
          </span>
        </div>
      )}
      <L label={t("st.note")}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={inp} /></L>

      {/* Etsy API chính thức (Open API v3) — mỗi store 1 app riêng. Khuyên dùng thay cho extension. */}
      {store.marketplace === "etsy" && (
        <div style={{ border: "1px solid #CDEFD8", background: "#F3FBF6", borderRadius: 12, padding: "12px 14px", marginTop: 8 }}>
          <b style={{ fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}><IconKey width={15} height={15} /> Etsy API (official)</b>
          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 10px" }}>
            Each store uses its own Etsy app. Create one at etsy.com/developers (enable 2FA), register the callback URL below, then paste the Keystring + Shared Secret here and connect.
          </div>
          <L label="Callback URL — register this in your Etsy app">
            <div style={{ display: "flex", gap: 6 }}>
              <input readOnly value={oauthCb} style={{ ...inp, flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
              <button onClick={() => { navigator.clipboard?.writeText(oauthCb); flash(t("st.copiedUrl")); }} style={{ ...btnGhost, fontSize: 12 }}>Copy</button>
            </div>
          </L>
          <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <L label="Keystring (App API Key)"><input value={etsyKey} onChange={(e) => setEtsyKey(e.target.value)} onFocus={() => setRoEtsy(false)} readOnly={roEtsy} placeholder="e.g. 1aa2bb33c44d55…" style={inp} name="fusion-etsy-key" autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" /></L>
            <L label="Shared Secret"><input type="password" value={etsySecret} onChange={(e) => setEtsySecret(e.target.value)} onFocus={() => setRoEtsy(false)} readOnly={roEtsy} placeholder={store.etsy?.hasKeystring ? "••• (saved, leave blank to keep)" : "shared secret"} style={inp} name="fusion-etsy-secret" autoComplete="new-password" data-lpignore="true" data-1p-ignore data-form-type="other" /></L>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={saveEtsyApi} disabled={etsyBusy} style={{ ...btnGhost, fontSize: 12.5 }}>Save app</button>
            <button onClick={connectEtsy} disabled={etsyBusy || !(store.etsy?.hasKeystring || etsySaved)} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: 12.5, cursor: (store.etsy?.hasKeystring || etsySaved) ? "pointer" : "default", opacity: (store.etsy?.hasKeystring || etsySaved) ? 1 : 0.5 }} title={(store.etsy?.hasKeystring || etsySaved) ? "" : "Enter Keystring + Shared Secret and click Save app first"}>{store.etsy?.connected ? "Reconnect Etsy" : "Connect Etsy"}</button>
            {store.etsy?.connected && <button onClick={pullEtsy} disabled={etsyBusy} style={{ background: "#2E7D46", color: "#fff", border: 0, borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}><IconDownload width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Pull orders</button>}
            <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700 }}>
              {store.etsy?.connected
                ? <span style={{ color: "#2E7D46" }}><IconKey width={11} height={11} style={{ verticalAlign: "-1px" }} /> Connected · shop {store.etsy?.shopId}</span>
                : <span style={{ color: "var(--muted)" }}>Not connected</span>}
            </span>
          </div>
        </div>
      )}

      {store.marketplace === "tiktok" && (
        <div style={{ border: "1px solid #E8D9F5", background: "#FBF7FF", borderRadius: 12, padding: "12px 14px", marginTop: 8 }}>
          <b style={{ fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}><IconKey width={15} height={15} /> TikTok Shop API (official)</b>
          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 10px" }}>
            Create a <b>Custom app</b> on TikTok Shop Partner Center (target market US), register the Redirect URL below,
            apply Order scopes, then paste App Key + App Secret + the app&apos;s Authorization link here. One app can serve every shop.
          </div>
          <L label="Redirect URL — register this in your TikTok app">
            <div style={{ display: "flex", gap: 6 }}>
              <input readOnly value={`${CANONICAL}/api/tiktok/oauth/callback`} style={{ ...inp, flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
              <button onClick={() => { navigator.clipboard?.writeText(`${CANONICAL}/api/tiktok/oauth/callback`); flash(t("st.copiedUrl")); }} style={{ ...btnGhost, fontSize: 12 }}>Copy</button>
            </div>
          </L>
          <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <L label="App Key"><input value={ttKey} onChange={(e) => setTtKey(e.target.value)} placeholder="e.g. 6h2k4…" style={inp} autoComplete="off" data-lpignore="true" data-1p-ignore /></L>
            <L label="App Secret"><input type="password" value={ttSecret} onChange={(e) => setTtSecret(e.target.value)} placeholder={store.tiktok?.hasApp ? "••• (saved, leave blank to keep)" : "app secret"} style={inp} autoComplete="new-password" data-lpignore="true" data-1p-ignore /></L>
          </div>
          <L label="Authorization link (Partner Center → app detail → copy authorize URL)">
            <input value={ttAuthLink} onChange={(e) => setTtAuthLink(e.target.value)} placeholder="https://services.tiktokshop.com/open/authorize?service_id=…" style={{ ...inp, fontSize: 12 }} autoComplete="off" />
          </L>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={saveTtApi} disabled={ttBusy} style={{ ...btnGhost, fontSize: 12.5 }}>Save app</button>
            <button onClick={connectTt} disabled={ttBusy || !(store.tiktok?.hasApp || ttSaved)} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: 12.5, cursor: (store.tiktok?.hasApp || ttSaved) ? "pointer" : "default", opacity: (store.tiktok?.hasApp || ttSaved) ? 1 : 0.5 }} title={(store.tiktok?.hasApp || ttSaved) ? "" : "Enter App Key + Secret and click Save app first"}>{store.tiktok?.connected ? "Reconnect TikTok" : "Connect TikTok"}</button>
            <button onClick={ttConnectLink} disabled={ttBusy || !(store.tiktok?.hasApp || ttSaved)} style={{ ...btnGhost, fontSize: 12.5, opacity: (store.tiktok?.hasApp || ttSaved) ? 1 : 0.5 }} title="Copy the authorize link to open in the shop's AdsPower profile"><IconCopy width={12} height={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />Copy connect link</button>
            {store.tiktok?.connected && <button onClick={checkTt} disabled={ttBusy} style={{ ...btnGhost, fontSize: 12.5 }}>Check connection</button>}
            {store.tiktok?.connected && <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>Orders auto-pull every 15 min</span>}
            <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700 }}>
              {store.tiktok?.connected
                ? <span style={{ color: "#2E7D46" }}><IconKey width={11} height={11} style={{ verticalAlign: "-1px" }} /> Connected · {store.tiktok?.shopName || store.tiktok?.shopId}</span>
                : <span style={{ color: "var(--muted)" }}>Not connected</span>}
            </span>
          </div>
        </div>
      )}

      {/* Extension: Kéo đơn Etsy về FUSION (chỉ store Etsy) */}
      {store.marketplace === "etsy" && (
        <div style={{ border: "1px solid #CDE3FA", background: "#F3F9FF", borderRadius: 12, padding: "12px 14px", marginTop: 8 }}>
          <b style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}><IconPuzzle width={16} height={16} />{t("st.extTitle")}</b>
          <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 10px" }}>{t("st.extDesc")}{" "}<a href="/extension/" target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 800 }}>Download extension ↗</a></div>
          <L label="Ingest URL">
            <div style={{ display: "flex", gap: 6 }}>
              <input readOnly value={ingestUrl} style={{ ...inp, flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
              <button onClick={() => { navigator.clipboard?.writeText(ingestUrl); flash(t("st.copiedUrl")); }} style={{ ...btnGhost, fontSize: 12 }}>Copy</button>
            </div>
          </L>
          <L label="Store token (Bearer)">
            <div style={{ display: "flex", gap: 6 }}>
              <input readOnly type={showTok ? "text" : "password"} value={tok} style={{ ...inp, flex: 1, fontSize: 12, letterSpacing: showTok ? 0 : 2 }} onFocus={(e) => e.target.select()} />
              <button onClick={() => setShowTok((v) => !v)} style={{ ...btnGhost, fontSize: 12 }}>{showTok ? t("st.hide") : t("st.show")}</button>
              <button onClick={() => { navigator.clipboard?.writeText(tok); flash(t("st.copiedToken")); }} style={{ ...btnGhost, fontSize: 12 }}>Copy</button>
            </div>
          </L>
          <button onClick={regenToken} style={{ ...btnGhost, color: "var(--red)", borderColor: "#F3C0C0", fontSize: 12, marginTop: 4 }}><IconRefresh width={12} height={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("st.newToken")}</button>
        </div>
      )}

      {/* Setup API (generic) — Etsy/TikTok có khu riêng nên ẩn */}
      {store.marketplace !== "etsy" && store.marketplace !== "tiktok" && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <b style={{ fontSize: 13.5 }}>{t("st.apiConfig")}</b>
            {store.hasCredentials && <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 700 }}><IconKey width={12} height={12} style={{ verticalAlign: "-2px" }} /> {t("st.apiHas")}: {store.credentialKeys.join(", ")}</span>}
            <button onClick={check} disabled={busy} style={{ ...btnGhost, marginLeft: "auto", fontSize: 12 }}>{t("st.checkConn")}</button>
          </div>
          {health && (
            <div style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, marginBottom: 8, background: health.ok ? "var(--green-soft)" : "var(--red-soft)", color: health.ok ? "var(--green)" : "var(--red)" }}>
              {health.ok ? "✓" : "✗"} {health.message}
            </div>
          )}
          <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {fields.map(([k, label]) => (
              <L key={k} label={label}>
                <input type="password" placeholder={store.credentialKeys.includes(k) ? t("st.savedKept") : t("st.enterValue")}
                  onChange={(e) => setCred({ ...cred, [k]: e.target.value })} style={inp} autoComplete="new-password" data-lpignore="true" data-1p-ignore data-form-type="other" />
              </L>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Credentials are encrypted on the server and never shown again. Leave a field blank to keep the current value.</div>
        </div>
      )}
      <Actions close={close} onOk={save} busy={busy} okLabel={t("st.saveStore")} />
    </Modal>
  );
}

function Modal({ title, close, children }: { title: React.ReactNode; close: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(42,48,60,.45)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={close}>
      <div className="modal-card" style={{ background: "#fff", borderRadius: 16, width: 560, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
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
