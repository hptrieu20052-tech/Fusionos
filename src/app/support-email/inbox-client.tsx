"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * v392/v393 · Customer Emails — inbox 2 cột cho các hộp thư support.
 * v393: nhiều hộp thư — lọc theo mailbox, admin quản lý mailbox ngay tại đây (modal ⚙),
 * mật khẩu mã hoá server-side, nhân viên không bao giờ thấy.
 * HTML của khách render trong <iframe sandbox> để script/tracking trong mail không chạy được.
 */

type Account = { id: string; label: string; email: string; active: boolean };
type AdminAccount = Account & {
  fromName?: string | null; imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number;
  lastSyncAt?: string | null; lastSyncError?: string | null;
};
type Thread = {
  id: string; accountId: string | null; customerEmail: string; customerName: string | null; subject: string;
  status: string; lastDirection: string; lastMessageAt: string; lastSnippet: string;
  unread: boolean; msgCount: number;
};
type Att = { name: string; key: string; size: number; type: string; url: string | null };
type Msg = {
  id: string; direction: string; fromEmail: string; fromName: string | null;
  subject: string | null; bodyText: string | null; bodyHtml: string | null;
  attachments: Att[]; messageAt: string;
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const fmtFull = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const selStyle: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13, background: "#fff" };
const inpStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, width: "100%" };

/** Body 1 email: ưu tiên HTML (iframe sandbox, tự đo chiều cao), fallback text. */
function MailBody({ m }: { m: Msg }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(80);
  const html = m.bodyHtml;
  useEffect(() => {
    if (!html || !ref.current) return;
    const f = ref.current;
    const doc = `<!doctype html><html><head><base target="_blank"><style>body{margin:8px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.5;color:#222;word-break:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
    f.srcdoc = doc;
    const measure = () => {
      try { setH(Math.min(900, Math.max(60, (f.contentDocument?.body?.scrollHeight ?? 60) + 24))); } catch { /* sandbox */ }
    };
    f.onload = measure;
    const t = setTimeout(measure, 600); // ảnh load xong đo lại
    return () => clearTimeout(t);
  }, [html]);

  if (html) {
    return (
      <iframe
        ref={ref}
        sandbox="allow-same-origin allow-popups"
        title="email"
        style={{ width: "100%", height: h, border: 0, background: "#fff", borderRadius: 8, display: "block" }}
      />
    );
  }
  return <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.5, wordBreak: "break-word", padding: "2px 2px" }}>{m.bodyText || " "}</div>;
}

/** Modal quản lý hộp thư (ADMIN) — thêm/sửa/tắt mailbox, không cần env hay redeploy. */
function MailboxManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<AdminAccount[]>([]);
  const [envEmail, setEnvEmail] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // form thêm mới
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [fromName, setFromName] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [imapHost, setImapHost] = useState("mail.privateemail.com");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("mail.privateemail.com");
  const [smtpPort, setSmtpPort] = useState("465");

  const load = useCallback(async () => {
    try {
      const j = await fetch("/api/support-email/accounts").then((r) => r.json());
      if (j.ok) { setRows(j.accounts); setEnvEmail(j.envEmail ?? null); }
      else setErr(j.error || "Failed");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!label.trim() || !email.trim() || !pass) { setErr("Cần đủ tên hiển thị, email và mật khẩu"); return; }
    setBusy(true); setErr("");
    try {
      const j = await fetch("/api/support-email/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(), email: email.trim(), pass, fromName: fromName.trim(),
          imapHost, imapPort: Number(imapPort), smtpHost, smtpPort: Number(smtpPort),
        }),
      }).then((r) => r.json());
      if (j.ok) { setLabel(""); setEmail(""); setPass(""); setFromName(""); await load(); onChanged(); }
      else setErr(j.error || "Failed");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true); setErr("");
    try {
      const j = await fetch(`/api/support-email/accounts/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json());
      if (j.ok) { await load(); onChanged(); } else setErr(j.error || "Failed");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true); setErr("");
    try {
      const j = await fetch(`/api/support-email/accounts/${id}`, { method: "DELETE" }).then((r) => r.json());
      if (j.ok) { await load(); onChanged(); } else setErr(j.error || "Failed");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const changePass = (id: string) => {
    const p = window.prompt("Mật khẩu mới cho hộp thư này (được mã hoá trước khi lưu):");
    if (p) patch(id, { pass: p });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(680px, 100%)", maxHeight: "88vh", overflowY: "auto", padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>⚙ Mailboxes</h3>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...selStyle, cursor: "pointer" }}>✕</button>
        </div>
        {err && <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 10 }}>✗ {err}</div>}

        {/* Danh sách hộp thư hiện có */}
        {rows.map((a) => (
          <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginBottom: 8, opacity: a.active ? 1 : 0.55 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>{a.label}</span>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{a.email}</span>
              {!a.active && <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 8, padding: "0 6px" }}>OFF</span>}
              <div style={{ flex: 1 }} />
              <button onClick={() => changePass(a.id)} disabled={busy} style={{ ...selStyle, cursor: "pointer", fontSize: 12, padding: "5px 9px" }}>Đổi mật khẩu</button>
              <button onClick={() => patch(a.id, { active: !a.active })} disabled={busy} style={{ ...selStyle, cursor: "pointer", fontSize: 12, padding: "5px 9px" }}>{a.active ? "Tắt" : "Bật"}</button>
              <button onClick={() => remove(a.id)} disabled={busy} style={{ ...selStyle, cursor: "pointer", fontSize: 12, padding: "5px 9px", color: "var(--red)" }}>Xoá</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
              IMAP {a.imapHost}:{a.imapPort} · SMTP {a.smtpHost}:{a.smtpPort}
              {a.lastSyncAt ? ` · sync ${fmtFull(String(a.lastSyncAt))}` : " · chưa sync"}
              {a.lastSyncError && <span style={{ color: "var(--red)" }}> · ✗ {a.lastSyncError}</span>}
            </div>
          </div>
        ))}
        {envEmail && !rows.some((r) => r.email.toLowerCase() === envEmail.toLowerCase()) && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            ℹ Hộp thư <b>{envEmail}</b> đang chạy bằng biến môi trường (SUPPORT_EMAIL) — vẫn hoạt động bình thường.
            Muốn quản lý tại đây thì thêm nó vào danh sách này rồi xoá env sau.
          </div>
        )}

        {/* Thêm hộp thư mới */}
        <div style={{ borderTop: "1px dashed var(--line)", marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>+ Thêm hộp thư</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Tên hiển thị (vd: Talewix)" style={inpStyle} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="support@store.com" style={inpStyle} />
            <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder="Mật khẩu hộp thư" style={inpStyle} autoComplete="new-password" />
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder='Tên người gửi (vd: "Talewix Support")' style={inpStyle} />
          </div>
          <button onClick={() => setShowAdv((v) => !v)} style={{ background: "none", border: 0, color: "var(--blue)", fontSize: 12, cursor: "pointer", padding: "6px 0" }}>
            {showAdv ? "▾" : "▸"} Nâng cao (host/port — mặc định PrivateEmail)
          </button>
          {showAdv && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr 1fr", gap: 8, marginBottom: 8 }}>
              <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="IMAP host" style={inpStyle} />
              <input value={imapPort} onChange={(e) => setImapPort(e.target.value)} placeholder="993" style={inpStyle} />
              <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="SMTP host" style={inpStyle} />
              <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="465" style={inpStyle} />
            </div>
          )}
          <button onClick={add} disabled={busy} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 9, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Đang lưu…" : "Thêm hộp thư"}
          </button>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>
            Mật khẩu được mã hoá (AES-256) trước khi lưu — nhân viên support không bao giờ nhìn thấy.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InboxClient({ level, isAdmin, configured }: { level: number; isAdmin: boolean; configured: boolean }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("open");
  const [accFilter, setAccFilter] = useState<string>(""); // "" = tất cả hộp thư
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingM, setLoadingM] = useState(false);
  const [errM, setErrM] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [showMailboxes, setShowMailboxes] = useState(false);
  const [ready, setReady] = useState(configured);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel?.id ?? null;

  const accLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.label);
    return (t: Thread) => m.get(t.accountId ?? "env") ?? "";
  }, [accounts]);

  const loadThreads = useCallback(async (f: "all" | "open" | "closed", acc: string) => {
    setLoading(true); setErr("");
    try {
      const qs = new URLSearchParams();
      if (f !== "all") qs.set("status", f);
      if (acc) qs.set("account", acc);
      const q = qs.toString();
      const j = await fetch(`/api/support-email/threads${q ? `?${q}` : ""}`).then((r) => r.json());
      if (j.ok) { setThreads(j.threads); setAccounts(j.accounts ?? []); setReady(!!j.configured); }
      else setErr(j.error || "Failed to load");
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    setLoading(false);
  }, []);

  const openThread = async (t: Thread) => {
    setSel(t); setMsgs([]); setErrM(""); setLoadingM(true);
    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread: false } : x)));
    try {
      const j = await fetch(`/api/support-email/threads/${t.id}`).then((r) => r.json());
      if (j.ok) {
        if (selRef.current !== t.id) return; // user đã bấm thread khác
        setSel(j.thread); setMsgs(j.messages);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 60);
      } else setErrM(j.error || "Failed to load messages");
    } catch (e) { setErrM(String((e as Error)?.message ?? e)); }
    setLoadingM(false);
  };

  useEffect(() => { loadThreads(filter, accFilter); }, [filter, accFilter, loadThreads]);
  // Tự refresh danh sách mỗi 60s (mail mới do cron kéo về).
  useEffect(() => {
    const t = setInterval(() => loadThreads(filter, accFilter), 60_000);
    return () => clearInterval(t);
  }, [filter, accFilter, loadThreads]);

  const syncNow = async () => {
    setSyncing(true); setSyncNote("");
    try {
      const j = await fetch("/api/support-email/sync", { method: "POST" }).then((r) => r.json());
      if (j.ok) {
        setSyncNote(`✓ Quét ${j.scanned ?? 0} mail, ${j.created ?? 0} mới`);
        await loadThreads(filter, accFilter);
        if (sel) { const cur = sel; await openThread(cur); }
      } else setSyncNote("✗ " + (j.error || "Sync failed"));
    } catch (e) { setSyncNote("✗ " + String((e as Error)?.message ?? e)); }
    setSyncing(false);
  };

  const send = async () => {
    if (!sel || !reply.trim() || sending) return;
    setSending(true); setErrM("");
    try {
      const j = await fetch("/api/support-email/reply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: sel.id, body: reply.trim() }),
      }).then((r) => r.json());
      if (j.ok) {
        setReply("");
        await openThread(sel);
        loadThreads(filter, accFilter);
      } else setErrM("✗ " + (j.error || "Send failed"));
    } catch (e) { setErrM("✗ " + String((e as Error)?.message ?? e)); }
    setSending(false);
  };

  const setStatus = async (status: "open" | "closed") => {
    if (!sel) return;
    try {
      const j = await fetch(`/api/support-email/threads/${sel.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => r.json());
      if (j.ok) { setSel({ ...sel, status }); loadThreads(filter, accFilter); }
      else setErrM("✗ " + (j.error || "Failed"));
    } catch (e) { setErrM("✗ " + String((e as Error)?.message ?? e)); }
  };

  const unreadCount = useMemo(() => threads.filter((t) => t.unread).length, [threads]);
  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);
  const manyAccounts = accounts.length > 1;

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>✉ Customer Emails</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {manyAccounts ? `${accounts.length} hộp thư` : (accounts[0]?.email ?? "")}{unreadCount ? ` · ${unreadCount} chưa đọc` : ""}
        </span>
        <div style={{ flex: 1 }} />
        {syncNote && <span style={{ fontSize: 12, color: syncNote.startsWith("✓") ? "var(--green, #1E8E4E)" : "var(--red)" }}>{syncNote}</span>}
        {manyAccounts && (
          <select value={accFilter} onChange={(e) => { setAccFilter(e.target.value); setSel(null); setMsgs([]); }} style={selStyle}>
            <option value="">Tất cả hộp thư</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.email}</option>)}
          </select>
        )}
        <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "open" | "closed")} style={selStyle}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <button onClick={syncNow} disabled={syncing || !ready} style={{ ...selStyle, cursor: "pointer", fontWeight: 700, opacity: syncing ? 0.6 : 1 }}>
          {syncing ? "Syncing…" : "↻ Sync now"}
        </button>
        {isAdmin && (
          <button onClick={() => setShowMailboxes(true)} style={{ ...selStyle, cursor: "pointer", fontWeight: 700 }}>⚙ Mailboxes</button>
        )}
      </div>

      {!ready && (
        <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>
          ✗ Chưa có hộp thư nào{isAdmin ? " — bấm ⚙ Mailboxes để thêm (email + mật khẩu hộp thư, chạy ngay không cần redeploy)." : " — nhờ admin thêm trong ⚙ Mailboxes."}
        </div>
      )}
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>✗ {err}</div>}

      <div style={{ display: "flex", gap: 0, border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", height: 620 }}>
        {/* LEFT: thread list */}
        <div style={{ width: 330, borderRight: "1px solid var(--line)", overflowY: "auto", flexShrink: 0, background: "#fff" }}>
          {loading && !threads.length && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
          {!loading && !threads.length && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Không có email nào{filter !== "all" ? ` (${filter})` : ""}.</div>}
          {threads.map((t) => (
            <button key={t.id} onClick={() => openThread(t)} style={{
              display: "block", width: "100%", textAlign: "left", padding: "11px 12px", border: 0,
              borderBottom: "1px solid var(--line)", background: sel?.id === t.id ? "var(--blue-soft)" : "#fff", cursor: "pointer",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  {t.unread && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--blue)", flexShrink: 0 }} />}
                  <span style={{ fontWeight: t.unread ? 800 : 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.customerName || t.customerEmail}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{fmtTime(t.lastMessageAt)}</span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: t.unread ? 700 : 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.subject || "(no subject)"}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginTop: 2, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.lastDirection === "out" ? "You: " : ""}{t.lastSnippet || "—"}
                </span>
                <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {manyAccounts && accLabel(t) && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--blue)", background: "var(--blue-soft)", borderRadius: 8, padding: "0 6px" }}>{accLabel(t)}</span>
                  )}
                  {t.status === "closed" && <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 8, padding: "0 6px" }}>CLOSED</span>}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* RIGHT: conversation */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!sel ? (
            <div style={{ margin: "auto", color: "var(--muted)", fontSize: 13 }}>Chọn 1 email bên trái.</div>
          ) : (
            <>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.subject || "(no subject)"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {sel.customerName ? `${sel.customerName} · ` : ""}{sel.customerEmail}
                    {manyAccounts && accLabel(sel) ? ` · hộp thư: ${accLabel(sel)}` : ""}
                  </div>
                </div>
                {level >= 2 && (
                  sel.status === "open"
                    ? <button onClick={() => setStatus("closed")} style={{ ...selStyle, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✓ Close</button>
                    : <button onClick={() => setStatus("open")} style={{ ...selStyle, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>↺ Reopen</button>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 16, background: "#F7F9FC" }}>
                {loadingM && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
                {errM && <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 8 }}>{errM}</div>}
                {msgs.map((m) => {
                  const mine = m.direction === "out";
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 14 }}>
                      <div style={{ width: "min(92%, 640px)" }}>
                        <div style={{ fontSize: 10.5, color: "var(--muted)", margin: mine ? "0 4px 2px 0" : "0 0 2px 4px", textAlign: mine ? "right" : "left" }}>
                          {mine ? (m.fromName || "Support") : (m.fromName || m.fromEmail)} · {fmtFull(m.messageAt)}
                        </div>
                        <div style={{
                          background: "#fff", border: mine ? "1.5px solid var(--blue)" : "1px solid var(--line)",
                          borderRadius: 12, padding: 8, overflow: "hidden",
                        }}>
                          <MailBody m={m} />
                          {m.attachments?.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
                              {m.attachments.map((a, i) => (
                                a.url
                                  ? <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, border: "1px solid var(--line)", borderRadius: 8, padding: "3px 9px", textDecoration: "none", color: "var(--blue)" }}>📎 {a.name} <span style={{ color: "var(--muted)" }}>({fmtSize(a.size)})</span></a>
                                  : <span key={i} style={{ fontSize: 12, border: "1px solid var(--line)", borderRadius: 8, padding: "3px 9px", color: "var(--muted)" }}>📎 {a.name}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              {level >= 2 ? (
                <div style={{ borderTop: "1px solid var(--line)", padding: 10, display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
                    placeholder={ready ? "Trả lời khách…  (Ctrl+Enter để gửi)" : "Chưa cấu hình hộp thư — không gửi được"}
                    disabled={sending || !ready}
                    rows={Math.min(6, Math.max(2, reply.split("\n").length))}
                    style={{ flex: 1, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13.5, resize: "vertical", fontFamily: "inherit", lineHeight: 1.45 }}
                  />
                  <button onClick={send} disabled={sending || !reply.trim() || !ready} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 9, padding: "10px 20px", fontWeight: 700, fontSize: 13.5, cursor: sending || !reply.trim() ? "default" : "pointer", opacity: sending || !reply.trim() || !ready ? 0.6 : 1 }}>
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              ) : (
                <div style={{ borderTop: "1px solid var(--line)", padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>
                  Bạn có quyền xem. Trả lời cần quyền Support mức 2 (full).
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}>
        Mail mới được hệ thống tự kéo về định kỳ; bấm ↻ Sync now để lấy ngay. Trả lời gửi đi từ đúng hộp thư của từng thread.
        {activeAccounts.length > 0 && ` Đang bật: ${activeAccounts.map((a) => a.email).join(", ")}.`}
      </div>

      {showMailboxes && <MailboxManager onClose={() => setShowMailboxes(false)} onChanged={() => loadThreads(filter, accFilter)} />}
    </div>
  );
}
