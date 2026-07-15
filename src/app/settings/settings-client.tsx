"use client";
import { useEffect, useRef, useState } from "react";
import { Flash } from "@/components/flash";
import { IconTrash, IconPencil, IconUpload } from "@/components/icons";
import { useLang } from "@/components/lang-provider";
import { SkuMappingClient } from "@/app/sku-mapping/sku-mapping-client";
import { useConfirm } from "@/components/confirm-provider";
import { SupplierLogo } from "@/components/supplier-logo";

type Ff = { id: string; name: string; method: string; apiEndpoint: string | null; credentials: string | null; shopId: string | null; identifier: string | null; hasWebhookSecret: boolean; autoPush: boolean; status: string };
type Map = { id: string; internalSku: string; fulfillerId: string; fulfillerSku: string; productType: string | null; variant: string | null; baseCost: string; shipCost: string; active: boolean };
const inp = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit", fontSize: 12.5 } as const;


export function SettingsClient({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const { t } = useLang();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"api" | "sku">("api");
  const [ffs, setFfs] = useState<Ff[]>([]);
  const [maps, setMaps] = useState<Map[]>([]);
  const [edit, setEdit] = useState<Record<string, { apiEndpoint: string; apiKey: string; webhookSecret: string; shopId: string; identifier: string }>>({});
  const [nf, setNf] = useState({ name: "", method: "api", apiEndpoint: "" });
  const [nm, setNm] = useState({ internalSku: "", fulfillerId: "", fulfillerSku: "", baseCost: "", shipCost: "" });
  const [msg, setMsg] = useState("");
  const [shops, setShops] = useState<Record<string, { id: number; title: string }[] | "loading" | string>>({});
  const [editOpen, setEditOpen] = useState<Record<string, boolean>>({});

  const setE = (id: string, field: string, value: string) =>
    setEdit((prev) => {
      const base = prev[id] ?? { apiEndpoint: "", apiKey: "", webhookSecret: "", shopId: "", identifier: "" };
      return { ...prev, [id]: { ...base, [field]: value } };
    });

  const load = () => fetch("/api/fulfillers").then((r) => r.json()).then((j) => { if (j.ok) { setFfs(j.fulfillers); setMaps(j.mappings ?? []); } });
  useEffect(() => { load(); }, []);

  async function saveFf(id: string) {
    const e = edit[id]; if (!e) return;
    const j = await fetch("/api/fulfillers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...e }) }).then((r) => r.json());
    setMsg(j.ok ? t("s.saved") : "⚠ " + j.error); if (j.ok) { setEdit({ ...edit, [id]: { apiEndpoint: "", apiKey: "", webhookSecret: "", shopId: "", identifier: "" } }); setEditOpen((p) => ({ ...p, [id]: false })); load(); }
  }
  async function listShops(id: string) {
    const token = edit[id]?.apiKey;
    setShops((p) => ({ ...p, [id]: "loading" }));
    const j = await fetch("/api/fulfillers/printify-shops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(token ? { token } : { fulfillerId: id }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) setShops((p) => ({ ...p, [id]: j.shops }));
    else { setShops((p) => ({ ...p, [id]: "err:" + (j.error ?? t("set.errLow")) })); }
  }
  // Đăng ký webhook Printway (order + tracking) trỏ về /api/webhooks/printway
  async function registerPwWebhook(id: string) {
    setMsg("Registering Printway webhook…");
    const j = await fetch("/api/fulfillers/printway-register-webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: id }) }).then((r) => r.json()).catch(() => ({ ok: false, errors: ["network"] }));
    if (j.ok) { setMsg(`✓ Webhook registered → ${j.endpoint}`); load(); }
    else setMsg("⚠ " + (Array.isArray(j.errors) && j.errors.length ? j.errors.join(" · ") : (j.error ?? "webhook register failed")));
  }
  // Đăng ký webhook ONOS (order.updated + shipment.events) trỏ về /api/webhooks/onos
  async function registerOnosWebhook(id: string) {
    setMsg("Registering ONOS webhook…");
    const j = await fetch("/api/fulfillers/onos-register-webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: id }) }).then((r) => r.json()).catch(() => ({ ok: false, errors: ["network"] }));
    if (j.ok) { setMsg(`✓ Webhook registered → ${j.endpoint}` + (Array.isArray(j.errors) && j.errors.length ? ` · partial: ${j.errors.join(" · ")}` : "")); load(); }
    else setMsg("⚠ " + (Array.isArray(j.errors) && j.errors.length ? j.errors.join(" · ") : (j.error ?? "webhook register failed")));
  }
  async function delFf(id: string, name: string) {
    if (!(await confirm({ message: t("set.deleteFulfillerConfirm").replace("{name}", name), danger: true }))) return;
    const j = await fetch("/api/fulfillers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((r) => r.json());
    setMsg(j.ok ? t("set.deleted") : "⚠ " + j.error); if (j.ok) load();
  }
  async function addFf(e: React.FormEvent) {
    e.preventDefault();
    const j = await fetch("/api/fulfillers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nf) }).then((r) => r.json());
    setMsg(j.ok ? t("s.addedFulfiller") : "⚠ " + j.error); if (j.ok) { setNf({ name: "", method: "api", apiEndpoint: "" }); load(); }
  }
  async function addMap(e: React.FormEvent) {
    e.preventDefault();
    const j = await fetch("/api/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nm) }).then((r) => r.json());
    setMsg(j.ok ? t("s.addedMapping") : "⚠ " + j.error); if (j.ok) { setNm({ internalSku: "", fulfillerId: "", fulfillerSku: "", baseCost: "", shipCost: "" }); load(); }
  }

  return (
    <>
      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>{t("s.title")}</h3>
        <div className="sub">{t("s.sub1")} <a href="/admin" style={{ color: "var(--blue)", fontWeight: 700 }}>{t("s.adminPage")}</a>.</div>
        <Flash msg={msg} />
        {/* 2 tab: Fulfillment API · SKU mapping */}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {([["api", t("s.tabApi")], ["sku", t("s.tabSku")]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700,
                border: tab === k ? "1.5px solid var(--blue)" : "1px solid var(--line)",
                background: tab === k ? "var(--blue-soft)" : "var(--card)", color: tab === k ? "var(--blue)" : "var(--ink)" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "api" && <>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>{t("s.fulfillmentApi")} · {ffs.length}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
          {ffs.map((f) => (
            <div key={f.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "13px 15px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <SupplierLogo name={f.name} size={22} />
                <b style={{ fontSize: 13.5 }}>{f.name}</b>
                <span className="chip">{f.method}</span>
                {f.credentials ? <span className="badge b-ship">Token {f.credentials}</span> : <span className="badge b-issue">{t("s.noApiKey")}</span>}
                {f.apiEndpoint && <span className="badge b-mut" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.apiEndpoint}>URL: {f.apiEndpoint}</span>}
                {f.shopId && <span className="badge b-ship">Shop ID: {f.shopId}</span>}
                {f.identifier && <span className="badge b-ship">ID: {f.identifier}</span>}
                {f.hasWebhookSecret ? <span className="badge b-ship">{t("s.hasWebhook")}</span> : <span className="badge b-mut">{t("s.noWebhook")}</span>}
                {isAdmin && <button type="button" onClick={() => setEditOpen((p) => ({ ...p, [f.id]: !p[f.id] }))}
                  style={{ marginLeft: "auto", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 9, padding: "5px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12, color: "var(--blue)" }}>
                  {editOpen[f.id] ? t("set.close") : <><IconPencil width={12} height={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("c.edit")}</>}
                </button>}
                {isAdmin && <button type="button" onClick={() => delFf(f.id, f.name)} title={t("set.deleteFulfiller")}
                  style={{ background: "var(--card)", border: "1px solid #F3C7C7", borderRadius: 9, padding: "5px 10px", fontWeight: 700, cursor: "pointer", fontSize: 12, color: "var(--red)" }}><IconTrash width={14} height={14} /></button>}
              </div>
              {isAdmin && editOpen[f.id] && (() => {
                const isMerchize = f.name.toLowerCase().includes("merchize");
                const isPrintway = f.name.toLowerCase().includes("printway");
                const isOnos = f.name.toLowerCase().includes("onos");
                return (
                <div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <input placeholder={isMerchize ? "Base URL (…/bo-api)" : (f.apiEndpoint ?? "API endpoint")} value={edit[f.id]?.apiEndpoint ?? ""} onChange={(e) => setE(f.id, "apiEndpoint", e.target.value)} style={{ ...inp, flex: 1, minWidth: 180 }} />
                  <input placeholder={isMerchize ? "API Key (x-api-key)" : t("s.apiTokenNew")} value={edit[f.id]?.apiKey ?? ""} onChange={(e) => setE(f.id, "apiKey", e.target.value)} style={{ ...inp, width: 200 }} />
                  {isMerchize && <input placeholder="Identifier (vd hello.com)" value={edit[f.id]?.identifier ?? ""} onChange={(e) => setE(f.id, "identifier", e.target.value)} style={{ ...inp, width: 160 }} />}
                  {f.name.toLowerCase().includes("printify") && <>
                    <input placeholder="Shop ID" value={edit[f.id]?.shopId ?? ""} onChange={(e) => setE(f.id, "shopId", e.target.value)} style={{ ...inp, width: 110 }} />
                    <button type="button" onClick={() => listShops(f.id)} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>{t("s.getShop")}</button>
                  </>}
                  <input placeholder={t("s.webhookNew")} value={edit[f.id]?.webhookSecret ?? ""} onChange={(e) => setE(f.id, "webhookSecret", e.target.value)} style={{ ...inp, width: 150 }} />
                  <button onClick={() => saveFf(f.id)} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>{t("c.save")}</button>
                </div>
                {isPrintway && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" onClick={() => registerPwWebhook(f.id)} style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>Register webhook (order + tracking)</button>
                  </div>
                )}
                {isOnos && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" onClick={() => registerOnosWebhook(f.id)} style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>Register webhook (order + shipment)</button>
                  </div>
                )}

                </div>
                );
              })()}
              {/* Kết quả lấy shop Printify — bấm để điền Shop ID */}
              {shops[f.id] && (
                <div style={{ marginTop: 8, fontSize: 12.5 }}>
                  {shops[f.id] === "loading" ? <span style={{ color: "var(--muted)" }}>Fetching shops…</span>
                    : typeof shops[f.id] === "string" ? <span style={{ color: "var(--red)", fontWeight: 700 }}>⚠ {String(shops[f.id]).replace(/^err:/, "")}</span>
                    : (shops[f.id] as { id: number; title: string }[]).length === 0 ? <span style={{ color: "var(--muted)" }}>{t("set.tokenNoShop")}</span>
                    : <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ color: "var(--muted)", fontWeight: 700 }}>{t("s.shopList")}</span>
                        {(shops[f.id] as { id: number; title: string }[]).map((s) => (
                          <button key={s.id} type="button" onClick={() => setE(f.id, "shopId", String(s.id))}
                            style={{ background: "var(--blue-soft)", color: "var(--blue)", border: "1px solid #CFE0F5", borderRadius: 9, padding: "4px 10px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                            {s.title} = {s.id}
                          </button>
                        ))}
                        <span style={{ color: "var(--faint)", fontSize: 11 }}>{t("set.clickFillShop")}</span>
                      </div>}
                </div>
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <form onSubmit={addFf} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <b style={{ fontSize: 12.5, alignSelf: "center" }}>{t("s.addFulfiller")}</b>
            <input required placeholder={t("s.fulfillerNamePh")} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} style={{ ...inp, minWidth: 170 }} />
            <select value={nf.method} onChange={(e) => setNf({ ...nf, method: e.target.value })} style={inp}><option value="api">API</option><option value="excel">Excel</option></select>
            <input placeholder="API endpoint" value={nf.apiEndpoint} onChange={(e) => setNf({ ...nf, apiEndpoint: e.target.value })} style={{ ...inp, flex: 1, minWidth: 160 }} />
            <button style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>{t("set.add")}</button>
          </form>
        )}
      </div>

      {canEdit && <ExtensionPublishCard setMsg={setMsg} />}

      </>}

      {tab === "sku" && <SkuMappingClient canEdit={canEdit} />}
    </>
  );
}


// ===== Publish extension: admin upload zip bản mới → seller nhận badge NEW, KHÔNG cần deploy =====
function ExtensionPublishCard({ setMsg }: { setMsg: (m: string) => void }) {
  const [cur, setCur] = useState<string>("…");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch("/api/extension/version").then((r) => r.json()).then((j) => setCur(j.version ?? "?")).catch(() => setCur("?")); }, []);
  async function publish(e: React.FormEvent) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) { setMsg("⚠ Attach the extension .zip"); return; }
    setBusy(true);
    const fd = new FormData();
    fd.set("version", version.trim()); fd.set("notes", notes.trim()); fd.set("file", f);
    const j = await fetch("/api/extension/publish", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) { setMsg(`✓ Extension v${j.version} published — sellers will see the NEW badge within 6h`); setCur(j.version); setVersion(""); setNotes(""); if (fileRef.current) fileRef.current.value = ""; setFileName(""); }
    else setMsg("⚠ " + (j.error ?? "publish failed"));
  }
  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <h3 style={{ fontWeight: 800, fontSize: 14.5, display: "inline-flex", alignItems: "center", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logomark.png" alt="" style={{ width: 20, height: 20 }} />
          FUSION ETSY EXTENSION
        </h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Current version: <b style={{ color: "var(--ink)" }}>{cur}</b>
          {" · "}
          <a href="/extension/" target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>Seller download page ↗</a>
        </span>
      </div>

      {/* Grid 2 cột: hàng trên = 2 ô text, hàng dưới = chọn file + Publish.
          Trước đây dồn 4 phần tử vào 1 flex row nên bị bóp méo ở màn hình hẹp. */}
      <form onSubmit={publish} style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
          <input required placeholder="Version x.y.z (must match manifest.json)" value={version} onChange={(e) => setVersion(e.target.value)} style={{ ...inp, width: "100%" }} />
          <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inp, width: "100%" }} />
        </div>
        <input ref={fileRef} required type="file" accept=".zip" style={{ display: "none" }} onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => fileRef.current?.click()}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--line)", background: "var(--card)", color: fileName ? "var(--ink)" : "var(--muted)", borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12.5, maxWidth: 320, overflow: "hidden" }}>
            <IconUpload width={13} height={13} />
            <span style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{fileName || "Choose .zip"}</span>
          </button>
          <button disabled={busy} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 18px", fontWeight: 800, cursor: busy ? "wait" : "pointer", fontSize: 12.5, opacity: busy ? 0.6 : 1, marginLeft: "auto" }}>
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </form>
    </div>
  );
}

