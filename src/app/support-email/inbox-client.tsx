"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pager } from "@/components/pager";

/**
 * v392–v394 · Customer Emails — webmail thu gọn trong FUSION.
 * v394: cột FOLDER như PrivateEmail (Inbox/Sent/Archive/Spam/Trash/Drafts) + phân trang 20 thread/trang.
 * Giữ chất FUSION: lọc theo hộp thư (store), Open/Closed, quyền module support, admin quản lý Mailboxes.
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
  id: string; direction: string; folder?: string; fromEmail: string; fromName: string | null;
  subject: string | null; bodyText: string | null; bodyHtml: string | null;
  attachments: Att[]; messageAt: string;
};

// Icon line-style (stroke) như webmail — currentColor nên tự trắng khi folder đang chọn.
const fIc = (paths: React.ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>{paths}</svg>
);
const FOLDERS: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: "inbox", label: "Inbox", icon: fIc(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" /></>) },
  { key: "sent", label: "Sent", icon: fIc(<><line x1="22" y1="2" x2="11" y2="13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></>) },
  { key: "archive", label: "Archive", icon: fIc(<><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></>) },
  { key: "spam", label: "Spam", icon: fIc(<><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></>) },
  { key: "trash", label: "Trash", icon: fIc(<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>) },
  { key: "drafts", label: "Drafts", icon: fIc(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /></>) },
];

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
    if (!label.trim() || !email.trim() || !pass) { setErr("Label, email and password are required"); return; }
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
    const p = window.prompt("New password for this mailbox:");
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
              <button onClick={() => changePass(a.id)} disabled={busy} style={{ ...selStyle, cursor: "pointer", fontSize: 12, padding: "5px 9px" }}>Change password</button>
              <button onClick={() => patch(a.id, { active: !a.active })} disabled={busy} style={{ ...selStyle, cursor: "pointer", fontSize: 12, padding: "5px 9px" }}>{a.active ? "Disable" : "Enable"}</button>
              <button onClick={() => remove(a.id)} disabled={busy} style={{ ...selStyle, cursor: "pointer", fontSize: 12, padding: "5px 9px", color: "var(--red)" }}>Delete</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
              IMAP {a.imapHost}:{a.imapPort} · SMTP {a.smtpHost}:{a.smtpPort}
              {a.lastSyncAt ? ` · sync ${fmtFull(String(a.lastSyncAt))}` : " · not synced yet"}
              {a.lastSyncError && <span style={{ color: "var(--red)" }}> · ✗ {a.lastSyncError}</span>}
            </div>
          </div>
        ))}
        {envEmail && !rows.some((r) => r.email.toLowerCase() === envEmail.toLowerCase()) && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            ℹ <b>{envEmail}</b> is configured via server environment variables and works normally.
          </div>
        )}

        {/* Thêm hộp thư mới */}
        <div style={{ borderTop: "1px dashed var(--line)", marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>+ Add mailbox</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Display name (e.g. Talewix)" style={inpStyle} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="support@store.com" style={inpStyle} />
            <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder="Mailbox password" style={inpStyle} autoComplete="new-password" />
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder='Sender name (e.g. "Talewix Support")' style={inpStyle} />
          </div>
          <button onClick={() => setShowAdv((v) => !v)} style={{ background: "none", border: 0, color: "var(--blue)", fontSize: 12, cursor: "pointer", padding: "6px 0" }}>
            {showAdv ? "▾" : "▸"} Advanced (host/port)
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
            {busy ? "Saving…" : "Add mailbox"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InboxClient({ level, isAdmin, configured }: { level: number; isAdmin: boolean; configured: boolean }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folder, setFolder] = useState("inbox");
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [accFilter, setAccFilter] = useState<string>(""); // "" = tất cả hộp thư
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
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

  const loadThreads = useCallback(async (fd: string, f: "all" | "open" | "closed", acc: string, p: number) => {
    setLoading(true); setErr("");
    try {
      const qs = new URLSearchParams({ folder: fd, page: String(p) });
      if (f !== "all") qs.set("status", f);
      if (acc) qs.set("account", acc);
      const j = await fetch(`/api/support-email/threads?${qs.toString()}`).then((r) => r.json());
      if (j.ok) {
        setThreads(j.threads); setAccounts(j.accounts ?? []); setReady(!!j.configured);
        setFolderCounts(j.folderCounts ?? {}); setTotalPages(j.totalPages ?? 1);
        if (j.page && j.page !== p) setPage(j.page);
      } else setErr(j.error || "Failed to load");
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

  useEffect(() => { loadThreads(folder, filter, accFilter, page); }, [folder, filter, accFilter, page, loadThreads]);
  // Tự refresh danh sách mỗi 60s (mail mới do cron kéo về).
  useEffect(() => {
    const t = setInterval(() => loadThreads(folder, filter, accFilter, page), 60_000);
    return () => clearInterval(t);
  }, [folder, filter, accFilter, page, loadThreads]);

  const pickFolder = (fd: string) => { setFolder(fd); setPage(1); setSel(null); setMsgs([]); };

  const syncNow = async () => {
    setSyncing(true); setSyncNote("");
    try {
      const j = await fetch("/api/support-email/sync", { method: "POST" }).then((r) => r.json());
      if (j.ok) {
        setSyncNote(`✓ Scanned ${j.scanned ?? 0}, ${j.created ?? 0} new`);
        await loadThreads(folder, filter, accFilter, page);
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
        loadThreads(folder, filter, accFilter, page);
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
      if (j.ok) { setSel({ ...sel, status }); loadThreads(folder, filter, accFilter, page); }
      else setErrM("✗ " + (j.error || "Failed"));
    } catch (e) { setErrM("✗ " + String((e as Error)?.message ?? e)); }
  };

  const unreadCount = useMemo(() => threads.filter((t) => t.unread).length, [threads]);
  const manyAccounts = accounts.length > 1;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 4px" }}>
      {/* Hero — đồng bộ layout với Manage Products (Shopify/TikTok/ShopBase/Amazon) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg, #EAF2FF, #F2FBFF)", border: "1px solid #CBDDF3", borderRadius: 16, padding: "16px 20px", marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
        </span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#14213D" }}>Customer <span style={{ color: "var(--blue)" }}>Emails</span>{unreadCount > 0 && <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 800, color: "#fff", background: "var(--red)", borderRadius: 99, padding: "2px 9px", verticalAlign: "middle" }}>{unreadCount} new</span>}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
            {manyAccounts ? `${accounts.length} mailboxes` : (accounts[0]?.email ?? "—")}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {syncNote && <span style={{ fontSize: 12, fontWeight: 700, color: syncNote.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{syncNote}</span>}
          {manyAccounts && (
            <select value={accFilter} onChange={(e) => { setAccFilter(e.target.value); setPage(1); setSel(null); setMsgs([]); }} style={{ ...selStyle, borderRadius: 10 }}>
              <option value="">All mailboxes</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.email}</option>)}
            </select>
          )}
          <select value={filter} onChange={(e) => { setFilter(e.target.value as "all" | "open" | "closed"); setPage(1); }} style={{ ...selStyle, borderRadius: 10 }}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <button onClick={syncNow} disabled={syncing || !ready} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 11, padding: "10px 18px", fontWeight: 800, fontSize: 13.5, cursor: syncing ? "default" : "pointer", opacity: syncing || !ready ? 0.6 : 1, whiteSpace: "nowrap" }}>
            {syncing ? "Syncing…" : "↻ Sync now"}
          </button>
          {isAdmin && (
            <button onClick={() => setShowMailboxes(true)} style={{ background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 11, padding: "10px 16px", fontWeight: 800, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>⚙ Mailboxes</button>
          )}
        </div>
      </div>

      {!ready && (
        <div style={{ fontSize: 13, padding: "9px 13px", borderRadius: 10, marginBottom: 12, background: "var(--red-soft)", color: "var(--red)", fontWeight: 600 }}>
          ✗ No mailbox configured{isAdmin ? " — click ⚙ Mailboxes to add one." : " — ask an admin to add one in ⚙ Mailboxes."}
        </div>
      )}
      {err && <div style={{ fontSize: 13, padding: "9px 13px", borderRadius: 10, marginBottom: 12, background: "var(--red-soft)", color: "var(--red)", fontWeight: 600 }}>✗ {err}</div>}

      <div style={{ display: "flex", gap: 0, background: "#fff", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", height: 640, boxShadow: "var(--sh)" }}>
        {/* FOLDERS — như webmail */}
        <div style={{ width: 148, borderRight: "1px solid var(--line)", background: "#F7F9FC", flexShrink: 0, padding: "12px 8px", overflowY: "auto" }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".6px", padding: "0 9px", marginBottom: 8 }}>Folders</div>
          {FOLDERS.map((f) => {
            const active = folder === f.key;
            const n = folderCounts[f.key] ?? 0;
            return (
              <button key={f.key} onClick={() => pickFolder(f.key)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                padding: "9px 10px", marginBottom: 3, border: 0, borderRadius: 9, cursor: "pointer",
                background: active ? "var(--blue)" : "transparent",
                color: active ? "#fff" : "var(--ink)", fontWeight: active ? 800 : 600, fontSize: 13,
              }}>
                <span style={{ display: "flex", alignItems: "center", opacity: active ? 1 : 0.75 }}>{f.icon}</span>
                <span style={{ flex: 1 }}>{f.label}</span>
                {n > 0 && (
                  <span style={{
                    fontSize: 10.5, fontWeight: 800, borderRadius: 99, padding: "1px 7px",
                    background: active ? "rgba(255,255,255,.22)" : "var(--blue-soft)",
                    color: active ? "#fff" : "var(--blue)",
                  }}>{n}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* THREAD LIST + pager */}
        <div style={{ width: 336, borderRight: "1px solid var(--line)", flexShrink: 0, background: "#fff", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", background: "#F7F9FC", fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px", display: "flex", justifyContent: "space-between" }}>
            <span>{FOLDERS.find((f) => f.key === folder)?.label ?? folder}</span>
            <span>{folderCounts[folder] ?? 0}</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && !threads.length && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
            {!loading && !threads.length && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>No emails.</div>}
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
          {totalPages > 1 && (
            <div style={{ borderTop: "1px solid var(--line)", padding: "8px 8px", display: "flex", justifyContent: "center" }}>
              <Pager page={page} totalPages={totalPages} onPage={(p) => { setPage(p); setSel(null); setMsgs([]); }} />
            </div>
          )}
        </div>

        {/* CONVERSATION */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!sel ? (
            <div style={{ margin: "auto", color: "var(--muted)", fontSize: 13 }}>Select an email.</div>
          ) : (
            <>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.subject || "(no subject)"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {sel.customerName ? `${sel.customerName} · ` : ""}{sel.customerEmail}
                    {manyAccounts && accLabel(sel) ? ` · mailbox: ${accLabel(sel)}` : ""}
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
                          {m.folder && m.folder !== "inbox" && m.folder !== "sent" ? ` · ${m.folder}` : ""}
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
                    placeholder={ready ? "Reply…  (Ctrl+Enter to send)" : "No mailbox configured"}
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
                  View only. Replying requires Support level 2.
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {showMailboxes && <MailboxManager onClose={() => setShowMailboxes(false)} onChanged={() => loadThreads(folder, filter, accFilter, page)} />}
    </div>
  );
}
