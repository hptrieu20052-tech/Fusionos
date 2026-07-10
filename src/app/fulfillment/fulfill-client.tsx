"use client";
import { useEffect, useState } from "react";

type Pending = {
  id: string; externalId: string; platform: string;
  buyerFirst: string | null; buyerLast: string | null; city: string | null; state: string | null;
  items: { productTitle: string; internalSku: string | null; qty: number }[];
  fulfillerOptions: { fulfillerId: string; name: string; method: string; mapped: boolean; estCost: number | null }[];
};
type Pushed = { id: string; externalId: string | null; ffName: string | null; status: string; cost: string | null; tracking: string | null; externalFfId: string | null };

export function FulfillClient({ canPush, pushed }: { canPush: boolean; pushed: Pushed[] }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});

  const load = () => fetch("/api/fulfillment/pending").then((r) => r.json()).then((j) => j.ok && setPending(j.orders));
  useEffect(() => { load(); }, []);

  async function push(orderId: string) {
    const fulfillerId = sel[orderId] ?? pending.find((p) => p.id === orderId)?.fulfillerOptions.find((o) => o.mapped)?.fulfillerId;
    if (!fulfillerId) return;
    setMsg({ ...msg, [orderId]: "Pushing…" });
    const j = await fetch("/api/fulfillment/push", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, fulfillerId }),
    }).then((r) => r.json());
    if (j.ok) {
      setMsg({ ...msg, [orderId]: `Pushed · ${j.externalFfId} · cost $${j.cost.toFixed(2)}${j.simulated ? " (simulated — no real API key)" : ""}` });
      setTimeout(() => location.reload(), 900);
    } else {
      setMsg({ ...msg, [orderId]: "⚠ " + j.error });
    }
  }

  const badge = (s: string) => ({
    pushed: "b-new", in_production: "b-new", shipped: "b-ship", delivered: "b-ship", error: "b-issue", cancelled: "b-mut", pending: "b-mut",
  }[s] ?? "b-mut");

  return (
    <>
      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Orders waiting to fulfill · {pending.length}</h3>
        <div className="sub" style={{ marginBottom: 10 }}>Pick a fulfiller (estimated cost shown next to the name) then click Push — or export Excel for the fulfiller to process manually</div>
        {pending.length === 0 ? <div className="empty">No NEW orders waiting to push </div> : (
          <table>
            <thead><tr><th>Order ID</th><th>Product</th><th>Recipient</th><th>Fulfiller</th><th></th></tr></thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.id}>
                  <td><b style={{ color: "var(--blue)" }}>#{o.externalId}</b><div style={{ fontSize: 11, color: "var(--faint)" }}>{o.platform}</div></td>
                  <td>{o.items.map((i) => <div key={i.internalSku ?? i.productTitle} style={{ fontSize: 12.5 }}>{i.productTitle} <span style={{ color: "var(--faint)" }}>×{i.qty} · {i.internalSku ?? "no SKU"}</span></div>)}</td>
                  <td style={{ fontSize: 12.5 }}>{o.buyerFirst} {o.buyerLast}<div style={{ color: "var(--faint)", fontSize: 11 }}>{o.city}, {o.state}</div></td>
                  <td>
                    <select value={sel[o.id] ?? ""} onChange={(e) => setSel({ ...sel, [o.id]: e.target.value })}
                      style={{ padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 10, font: "inherit", fontSize: 12.5 }}>
                      <option value="">— select —</option>
                      {o.fulfillerOptions.map((f) => (
                        <option key={f.fulfillerId} value={f.fulfillerId} disabled={!f.mapped}>
                          {f.name}{f.mapped ? ` · ~$${f.estCost!.toFixed(2)}` : " · missing mapping"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {canPush && <button onClick={() => push(o.id)} disabled={!sel[o.id]}
                      style={{ background: sel[o.id] ? "var(--blue)" : "#C7CFEA", color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", fontWeight: 800, cursor: sel[o.id] ? "pointer" : "not-allowed", fontSize: 12.5 }}>
                      Push
                    </button>}
                    {msg[o.id] && <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 6, maxWidth: 220 }}>{msg[o.id]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Pushed · tracking</h3>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Order ID</th><th>Fulfiller</th><th>Fulfiller code</th><th>Cost</th><th>Tracking</th><th>Status</th></tr></thead>
          <tbody>
            {pushed.map((p) => (
              <tr key={p.id}>
                <td><b style={{ color: "var(--blue)" }}>#{p.externalId}</b></td>
                <td>{p.ffName}</td>
                <td style={{ fontSize: 12 }}>{p.externalFfId}</td>
                <td><b>${Number(p.cost ?? 0).toFixed(2)}</b></td>
                <td>{p.tracking ?? <span style={{ color: "var(--faint)" }}>waiting for webhook…</span>}</td>
                <td><span className={`badge ${badge(p.status)}`}>{p.status.toUpperCase()}</span></td>
              </tr>
            ))}
            {pushed.length === 0 && <tr><td colSpan={6} className="empty">No orders pushed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
