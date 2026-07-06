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
    setMsg({ ...msg, [orderId]: "Đang đẩy…" });
    const j = await fetch("/api/fulfillment/push", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, fulfillerId }),
    }).then((r) => r.json());
    if (j.ok) {
      setMsg({ ...msg, [orderId]: `Đẩy xong · ${j.externalFfId} · cost $${j.cost.toFixed(2)}${j.simulated ? " (simulate — chưa có API key thật)" : ""}` });
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
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Đơn chờ đẩy fulfill · {pending.length}</h3>
        <div className="sub" style={{ marginBottom: 10 }}>Chọn fulfiller (giá vốn ước tính hiện cạnh tên) rồi bấm Đẩy — hoặc xuất Excel cho fulfiller làm thủ công</div>
        {pending.length === 0 ? <div className="empty">Không còn đơn NEW nào chờ đẩy </div> : (
          <table>
            <thead><tr><th>Mã đơn</th><th>Sản phẩm</th><th>Người nhận</th><th>Fulfiller</th><th></th></tr></thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.id}>
                  <td><b style={{ color: "var(--blue)" }}>#{o.externalId}</b><div style={{ fontSize: 11, color: "var(--faint)" }}>{o.platform}</div></td>
                  <td>{o.items.map((i) => <div key={i.internalSku ?? i.productTitle} style={{ fontSize: 12.5 }}>{i.productTitle} <span style={{ color: "var(--faint)" }}>×{i.qty} · {i.internalSku ?? "chưa có SKU"}</span></div>)}</td>
                  <td style={{ fontSize: 12.5 }}>{o.buyerFirst} {o.buyerLast}<div style={{ color: "var(--faint)", fontSize: 11 }}>{o.city}, {o.state}</div></td>
                  <td>
                    <select value={sel[o.id] ?? ""} onChange={(e) => setSel({ ...sel, [o.id]: e.target.value })}
                      style={{ padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 10, font: "inherit", fontSize: 12.5 }}>
                      <option value="">— chọn —</option>
                      {o.fulfillerOptions.map((f) => (
                        <option key={f.fulfillerId} value={f.fulfillerId} disabled={!f.mapped}>
                          {f.name}{f.mapped ? ` · ~$${f.estCost!.toFixed(2)}` : " · thiếu mapping"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {canPush && <button onClick={() => push(o.id)} disabled={!sel[o.id]}
                      style={{ background: sel[o.id] ? "var(--blue)" : "#C7CFEA", color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", fontWeight: 800, cursor: sel[o.id] ? "pointer" : "not-allowed", fontSize: 12.5 }}>
                      Đẩy
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
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Đã đẩy · tracking</h3>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Mã đơn</th><th>Fulfiller</th><th>Mã bên fulfiller</th><th>Cost</th><th>Tracking</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {pushed.map((p) => (
              <tr key={p.id}>
                <td><b style={{ color: "var(--blue)" }}>#{p.externalId}</b></td>
                <td>{p.ffName}</td>
                <td style={{ fontSize: 12 }}>{p.externalFfId}</td>
                <td><b>${Number(p.cost ?? 0).toFixed(2)}</b></td>
                <td>{p.tracking ?? <span style={{ color: "var(--faint)" }}>chờ webhook…</span>}</td>
                <td><span className={`badge ${badge(p.status)}`}>{p.status.toUpperCase()}</span></td>
              </tr>
            ))}
            {pushed.length === 0 && <tr><td colSpan={6} className="empty">Chưa đẩy đơn nào.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
