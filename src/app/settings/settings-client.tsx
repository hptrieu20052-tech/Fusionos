"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/components/lang-provider";

type Ff = { id: string; name: string; method: string; apiEndpoint: string | null; credentials: string | null; hasWebhookSecret: boolean; autoPush: boolean; status: string };
type Map = { id: string; internalSku: string; fulfillerId: string; fulfillerSku: string; productType: string | null; variant: string | null; baseCost: string; shipCost: string; active: boolean };
const inp = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit", fontSize: 12.5 } as const;

export function SettingsClient({ canEdit, ingestConfigured }: { canEdit: boolean; ingestConfigured: boolean }) {
  const { t } = useLang();
  const [ffs, setFfs] = useState<Ff[]>([]);
  const [maps, setMaps] = useState<Map[]>([]);
  const [edit, setEdit] = useState<Record<string, { apiEndpoint: string; apiKey: string; webhookSecret: string; shopId: string }>>({});
  const [nf, setNf] = useState({ name: "", method: "api", apiEndpoint: "" });
  const [nm, setNm] = useState({ internalSku: "", fulfillerId: "", fulfillerSku: "", baseCost: "", shipCost: "" });
  const [msg, setMsg] = useState("");

  const setE = (id: string, field: string, value: string) =>
    setEdit((prev) => {
      const base = prev[id] ?? { apiEndpoint: "", apiKey: "", webhookSecret: "", shopId: "" };
      return { ...prev, [id]: { ...base, [field]: value } };
    });

  const load = () => fetch("/api/fulfillers").then((r) => r.json()).then((j) => { if (j.ok) { setFfs(j.fulfillers); setMaps(j.mappings); } });
  useEffect(() => { load(); }, []);

  async function saveFf(id: string) {
    const e = edit[id]; if (!e) return;
    const j = await fetch("/api/fulfillers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...e }) }).then((r) => r.json());
    setMsg(j.ok ? t("s.saved") : "⚠ " + j.error); if (j.ok) { setEdit({ ...edit, [id]: { apiEndpoint: "", apiKey: "", webhookSecret: "", shopId: "" } }); load(); }
  }
  async function listShops(id: string) {
    const token = edit[id]?.apiKey;
    const j = await fetch("/api/fulfillers/printify-shops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(token ? { token } : { fulfillerId: id }) }).then((r) => r.json());
    if (j.ok) setMsg(t("s.shopList") + " " + j.shops.map((s: { id: number; title: string }) => `${s.title} = ${s.id}`).join("  |  "));
    else setMsg("⚠ " + j.error);
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
        {msg && <div style={{ marginTop: 8, fontWeight: 700, fontSize: 12.5 }}>{msg}</div>}
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>{t("s.ingestTitle")}</h3>
        <div className="sub" style={{ marginTop: 6 }}>
          Endpoint: <b>POST /api/ingest/orders</b> · header <b>x-api-key</b> — key {ingestConfigured ? t("s.ingestKeyConfigured") : t("s.ingestKeyMissing")}.
          Webhook tracking fulfiller: <b>POST /api/webhooks/fulfillment</b> · header <b>x-webhook-secret</b> theo từng hãng bên dưới.
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Fulfillers · {ffs.length}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
          {ffs.map((f) => (
            <div key={f.id} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "13px 15px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13.5 }}>{f.name}</b>
                <span className="chip">{f.method}</span>
                {f.credentials ? <span className="badge b-ship">API key {f.credentials}</span> : <span className="badge b-issue">{t("s.noApiKey")}</span>}
                {f.hasWebhookSecret ? <span className="badge b-ship">{t("s.hasWebhook")}</span> : <span className="badge b-mut">{t("s.noWebhook")}</span>}
              </div>
              {canEdit && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <input placeholder={f.apiEndpoint ?? "API endpoint"} value={edit[f.id]?.apiEndpoint ?? ""} onChange={(e) => setE(f.id, "apiEndpoint", e.target.value)} style={{ ...inp, flex: 1, minWidth: 180 }} />
                  <input placeholder={t("s.apiTokenNew")} value={edit[f.id]?.apiKey ?? ""} onChange={(e) => setE(f.id, "apiKey", e.target.value)} style={{ ...inp, width: 160 }} />
                  {f.name.toLowerCase().includes("printify") && <>
                    <input placeholder="Shop ID" value={edit[f.id]?.shopId ?? ""} onChange={(e) => setE(f.id, "shopId", e.target.value)} style={{ ...inp, width: 110 }} />
                    <button type="button" onClick={() => listShops(f.id)} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>{t("s.getShop")}</button>
                  </>}
                  <input placeholder={t("s.webhookNew")} value={edit[f.id]?.webhookSecret ?? ""} onChange={(e) => setE(f.id, "webhookSecret", e.target.value)} style={{ ...inp, width: 150 }} />
                  <button onClick={() => saveFf(f.id)} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>Lưu</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <form onSubmit={addFf} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <b style={{ fontSize: 12.5, alignSelf: "center" }}>{t("s.addFulfiller")}</b>
            <input required placeholder={t("s.fulfillerNamePh")} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} style={{ ...inp, minWidth: 170 }} />
            <select value={nf.method} onChange={(e) => setNf({ ...nf, method: e.target.value })} style={inp}><option value="api">API</option><option value="excel">Excel</option></select>
            <input placeholder="API endpoint" value={nf.apiEndpoint} onChange={(e) => setNf({ ...nf, apiEndpoint: e.target.value })} style={{ ...inp, flex: 1, minWidth: 160 }} />
            <button style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>Thêm</button>
          </form>
        )}
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>SKU Mapping · {maps.length}</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>{t("s.internalSku")}</th><th>Fulfiller</th><th>{t("s.fulfillerSku")}</th><th>{t("s.typeVariant")}</th><th style={{ textAlign: "right" }}>Base</th><th style={{ textAlign: "right" }}>Ship</th><th style={{ textAlign: "right" }}>Tổng vốn</th></tr></thead>
            <tbody>
              {maps.map((m) => (
                <tr key={m.id}>
                  <td><b>{m.internalSku}</b></td>
                  <td>{ffs.find((f) => f.id === m.fulfillerId)?.name ?? "—"}</td>
                  <td style={{ fontSize: 12 }}>{m.fulfillerSku}</td>
                  <td style={{ fontSize: 12 }}>{m.productType} {m.variant ? `· ${m.variant}` : ""}</td>
                  <td style={{ textAlign: "right" }}>${Number(m.baseCost).toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>${Number(m.shipCost).toFixed(2)}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>${(Number(m.baseCost) + Number(m.shipCost)).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <form onSubmit={addMap} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <b style={{ fontSize: 12.5, alignSelf: "center" }}>＋ Mapping:</b>
            <input required placeholder={t("s.internalSku")} value={nm.internalSku} onChange={(e) => setNm({ ...nm, internalSku: e.target.value })} style={{ ...inp, width: 150 }} />
            <select required value={nm.fulfillerId} onChange={(e) => setNm({ ...nm, fulfillerId: e.target.value })} style={inp}>
              <option value="">— fulfiller —</option>
              {ffs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <input required placeholder={t("s.fulfillerSku")} value={nm.fulfillerSku} onChange={(e) => setNm({ ...nm, fulfillerSku: e.target.value })} style={{ ...inp, width: 160 }} />
            <input required type="number" step="0.01" placeholder="Base $" value={nm.baseCost} onChange={(e) => setNm({ ...nm, baseCost: e.target.value })} style={{ ...inp, width: 90 }} />
            <input type="number" step="0.01" placeholder="Ship $" value={nm.shipCost} onChange={(e) => setNm({ ...nm, shipCost: e.target.value })} style={{ ...inp, width: 90 }} />
            <button style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>Thêm</button>
          </form>
        )}
      </div>
    </>
  );
}
