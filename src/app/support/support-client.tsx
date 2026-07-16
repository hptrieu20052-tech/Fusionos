"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Store = { id: string; name: string; sellerId: string | null };
type Seller = { id: string; name: string | null };
type Conv = { id: string; storeId: string; storeName: string; buyerName: string; buyerAvatar: string | null; unread: number; canSend: boolean; lastText: string; lastFromBuyer: boolean; lastTime: number };
type Msg = { id: string; type: string; role: string; name: string; avatar: string | null; text: string; imageUrl: string | null; time: number; index: string };

const fmtTime = (t: number) => {
  if (!t) return "";
  const d = new Date(t * 1000);
  const now = Date.now();
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const isMine = (role: string) => role === "SHOP" || role === "CUSTOMER_SERVICE" || role === "SYSTEM" || role === "ROBOT";
const selStyle: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13, background: "#fff" };

export default function SupportClient({ stores, sellers = [] }: { stores: Store[]; sellers?: Seller[] }) {
  const [seller, setSeller] = useState("");
  const shopOptions = useMemo(() => (seller ? stores.filter((s) => s.sellerId === seller) : stores), [stores, seller]);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [loadingC, setLoadingC] = useState(false);
  const [errC, setErrC] = useState("");
  const [sel, setSel] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingM, setLoadingM] = useState(false);
  const [errM, setErrM] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConvs = async (sid: string) => {
    if (!sid) { setConvs([]); return; }
    setLoadingC(true); setErrC("");
    try {
      const j = await fetch(`/api/tiktok/support/conversations?storeId=${sid}`).then((r) => r.json());
      if (j.ok) setConvs(j.conversations);
      else setErrC(j.error || "Failed to load conversations");
    } catch (e) { setErrC(String((e as Error)?.message ?? e)); }
    setLoadingC(false);
  };

  const loadMsgs = async (c: Conv) => {
    setLoadingM(true); setErrM(""); setMsgs([]);
    try {
      const j = await fetch(`/api/tiktok/support/messages?storeId=${c.storeId}&conversationId=${c.id}`).then((r) => r.json());
      if (j.ok) { setMsgs(j.messages); setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 50); }
      else setErrM(j.error || "Failed to load messages");
    } catch (e) { setErrM(String((e as Error)?.message ?? e)); }
    setLoadingM(false);
  };

  useEffect(() => { setSel(null); setMsgs([]); loadConvs(storeId); /* eslint-disable-next-line */ }, [storeId]);
  // Khi đổi seller: nhảy sang store đầu của seller đó.
  useEffect(() => { const first = shopOptions[0]?.id ?? ""; setStoreId(first); /* eslint-disable-next-line */ }, [seller]);

  const openConv = async (c: Conv) => {
    setSel(c);
    await loadMsgs(c);
    if (c.unread > 0) {
      setConvs((prev) => prev.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
      fetch("/api/tiktok/support/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: c.storeId, conversationId: c.id }) }).catch(() => {});
    }
  };

  const send = async () => {
    if (!sel || !reply.trim()) return;
    setSending(true);
    const text = reply.trim();
    try {
      const j = await fetch("/api/tiktok/support/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: sel.storeId, conversationId: sel.id, text }) }).then((r) => r.json());
      if (j.ok) { setReply(""); await loadMsgs(sel); }
      else setErrM("✗ " + (j.error || "Send failed"));
    } catch (e) { setErrM("✗ " + String((e as Error)?.message ?? e)); }
    setSending(false);
  };

  const scopeHint = errC.includes("40006") || errC.toLowerCase().includes("scope") || errC.includes("no schema");

  if (!stores.length) return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Support</h2><p style={{ color: "var(--muted)" }}>No TikTok store connected.</p></div>;

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Support · Customer Messages</h2>
        <div style={{ flex: 1 }} />
        {sellers.length > 1 && (
          <select value={seller} onChange={(e) => setSeller(e.target.value)} style={selStyle}>
            <option value="">All sellers</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name || "—"}</option>)}
          </select>
        )}
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={selStyle}>
          {shopOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={() => { loadConvs(storeId); if (sel) loadMsgs(sel); }} disabled={loadingC} style={{ ...selStyle, cursor: "pointer", fontWeight: 700 }}>↻ Refresh</button>
      </div>

      {errC && (
        <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>
          ✗ {errC}{scopeHint && " — this needs the seller.customer_service scope. Add it in Partner Center and re-authorize the shop."}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", height: 560 }}>
        {/* LEFT: conversation list */}
        <div style={{ width: 320, borderRight: "1px solid var(--line)", overflowY: "auto", flexShrink: 0 }}>
          {loadingC && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
          {!loadingC && !convs.length && !errC && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>No conversations.</div>}
          {convs.map((c) => (
            <button key={c.id} onClick={() => openConv(c)} style={{
              display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "11px 12px", border: 0, borderBottom: "1px solid var(--line)",
              background: sel?.id === c.id ? "var(--blue-soft)" : "#fff", cursor: "pointer", alignItems: "center",
            }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#EEF1F5", flexShrink: 0, overflow: "hidden" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.buyerAvatar ? <img src={c.buyerAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.buyerName}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{fmtTime(c.lastTime)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.lastFromBuyer ? "" : "You: "}{c.lastText || "—"}</span>
                  {c.unread > 0 && <span style={{ background: "var(--red)", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 10, padding: "1px 7px", flexShrink: 0 }}>{c.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* RIGHT: thread */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!sel ? (
            <div style={{ margin: "auto", color: "var(--muted)", fontSize: 13 }}>Select a conversation.</div>
          ) : (
            <>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{sel.buyerName}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{sel.storeName}</div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 16, background: "#F7F9FC" }}>
                {loadingM && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
                {errM && <div style={{ color: "var(--red)", fontSize: 12.5 }}>{errM}</div>}
                {msgs.map((m) => {
                  const mine = isMine(m.role);
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 10 }}>
                      <div style={{ maxWidth: "72%" }}>
                        {!mine && <div style={{ fontSize: 10.5, color: "var(--muted)", margin: "0 0 2px 4px" }}>{m.name || m.role}</div>}
                        <div style={{ background: mine ? "var(--blue)" : "#fff", color: mine ? "#fff" : "var(--ink)", border: mine ? 0 : "1px solid var(--line)", borderRadius: 12, padding: m.imageUrl ? 4 : "8px 12px", fontSize: 13.5, lineHeight: 1.4, wordBreak: "break-word" }}>
                          {m.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.imageUrl} alt="" style={{ maxWidth: 220, borderRadius: 9, display: "block" }} />
                          ) : (m.text || " ")}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted)", textAlign: mine ? "right" : "left", margin: "2px 4px 0" }}>{fmtTime(m.time)}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              <div style={{ borderTop: "1px solid var(--line)", padding: 10, display: "flex", gap: 8 }}>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={sel.canSend ? "Type a reply…  (Enter to send)" : "Replying may be limited for this buyer"}
                  disabled={sending}
                  style={{ flex: 1, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13.5 }}
                />
                <button onClick={send} disabled={sending || !reply.trim()} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 9, padding: "0 20px", fontWeight: 700, fontSize: 13.5, cursor: sending || !reply.trim() ? "default" : "pointer", opacity: sending || !reply.trim() ? 0.6 : 1 }}>Send</button>
              </div>
            </>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}>Reads live from TikTok. Click ↻ Refresh for new messages (auto-refresh / webhook coming next).</div>
    </div>
  );
}

