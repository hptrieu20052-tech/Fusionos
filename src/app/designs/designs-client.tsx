"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { useLang } from "@/components/lang-provider";
import { IconCopy, IconDownload, IconEyeOpen, IconTrash, IconSparkle, IconUpload, IconRefresh } from "@/components/icons";

const KIND_KEY: Record<string, string> = { design_front: "d.kindFront", design_back: "d.kindBack", mockup: "d.kindMockup", video: "d.kindVideo" };
type FileRow = { id: string; kind: string; filename?: string | null; uploaderName?: string | null; thumbUrl: string | null; previewUrl: string | null; originalUrl: string | null; processingStatus: string; sizeBytes: number; width: number | null; height: number | null };
type Design = {
  id: string; skuCode: number; title: string; description: string | null; points: number;
  tags: string[]; personalize: boolean; personalization: string | null; productLink: string | null; note: string | null;
  platform: string | null; listed: boolean; createdAt: string;
  sellerId: string | null; designerId: string | null; creatorId: string | null; storeId: string | null;
  sellerName: string | null; designerName: string | null; creatorName: string | null; storeName?: string | null;
  avgScore: number | null; dims: string | null; sizeMB: string | null; downloadUrl: string | null;
  filesCount: number; cover: { thumb: string | null; preview: string | null; original: string | null; status: string } | null;
  coverLabel?: string | null; coverKind?: string | null;
  sides?: { id: string; kind: string; label: string; thumb: string | null; original: string | null }[];
};
type Opt = { id: string; name: string };
type Detail = {
  design: Design & Record<string, unknown>; files: FileRow[];
  ordersGenerated: { c: number; items: number }; avgScore: number; reviewCount: number;
  sellers: Opt[]; designers: Opt[]; creators: Opt[]; stores: Opt[];
};

const KINDS: [string, string][] = [["mockup", "Mockup"], ["design_front", "Design Front"], ["design_back", "Design Back"], ["video", "Video"]];
const fmtDate = (s: string) => new Date(s).toISOString().slice(0, 16).replace("T", " ");

// Link R2 là cross-origin → thuộc tính download của <a> bị bỏ qua (trình duyệt sẽ mở ảnh).
// Tải qua blob để ép tải xuống trực tiếp, đặt đúng tên file.
async function forceDownload(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = url.split("?")[0].split(".").pop() ?? "";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename.includes(".") ? filename : `${filename}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch {
    window.open(url, "_blank"); // fallback nếu fetch lỗi
  }
}

type ListData = { designs: Design[]; total: number; page: number; show: number; sellers: Opt[]; designers: Opt[] };
export default function DesignsClient({ canEdit }: { canEdit: boolean }) {
  const { t } = useLang();
  const [data, setData] = useState<ListData | null>(null);
  const [q, setQ] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [designerId, setDesignerId] = useState("");
  const [dr, setDr] = useState<RangeValue | null>({ range: "30d" });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Detail | null>(null);
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const show = 24;
  const designs = data?.designs ?? [];
  const total = data?.total ?? 0;

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), show: String(show) });
    if (q) p.set("q", q);
    if (sellerId) p.set("sellerId", sellerId);
    if (designerId) p.set("designerId", designerId);
    if (dr) { const d = rangeToDates(dr); p.set("from", d.from); p.set("to", d.to); }
    const j = await fetch(`/api/designs?${p}`).then((r) => r.json());
    if (j.ok) setData(j);
  }, [page, q, sellerId, designerId, dr]);
  useEffect(() => { const tm = setTimeout(load, q ? 300 : 0); return () => clearTimeout(tm); }, [load, q]);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2600); };
  const copyText = (v: string) => { navigator.clipboard?.writeText(v); flash(t("d.copied")); };

  // Flow upload 5 bước có sẵn
  async function doUpload(designId: string, file: File, kind: string) {
    const tk = await fetch("/api/designs/upload-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, filename: file.name, contentType: file.type || "application/octet-stream", kind }),
    }).then((r) => r.json());
    if (!tk.ok) throw new Error(tk.error ?? "upload-url error");
    let putRes: Response;
    try {
      putRes = await fetch(tk.url, { method: tk.method ?? "PUT", headers: tk.headers ?? {}, body: file });
    } catch {
      // fetch ném lỗi network = gần như chắc chắn CORS của bucket R2 chưa cho PUT từ domain này
      throw new Error("PUT → R2 blocked (CORS). Cloudflare R2 → bucket → Settings → CORS Policy → AllowedMethods PUT.");
    }
    if (!putRes.ok) throw new Error(`R2 rejected file (HTTP ${putRes.status}).`);
    const buf = await file.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const reg = await fetch("/api/designs/register-file", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, kind, storageKey: tk.storageKey, sha256: hash, sizeBytes: file.size, contentType: file.type, filename: file.name }),
    }).then((r) => r.json());
    if (!reg.ok) throw new Error(reg.error ?? "register error");
    if (!reg.deduped) await fetch("/api/designs/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: reg.file.id }) });
  }

  const openDetail = async (id: string) => {
    const j = await fetch(`/api/designs/${id}`).then((r) => r.json());
    if (j.ok) setSel(j);
  };

  return (
    <>
      {msg && <div style={{ position: "fixed", top: 16, right: 16, zIndex: 100, background: "#2A303C", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13.5 }}>{msg}</div>}

      {/* Page head */}
      <div className="page-head">
        <div className="page-actions">
          <DateRangePicker value={dr ?? { range: "" }} onChange={(v) => { setDr(v); setPage(1); }} align="right" allowClear onClear={() => { setDr(null); setPage(1); }} />
          {canEdit && <button onClick={() => setShowCreate(true)} className="btn btn-primary">{t("d.bulkUpload")}</button>}
        </div>
      </div>

      {/* Bộ lọc */}
      <div className="card" style={{ padding: "16px 18px", marginBottom: 14 }}>
        <div className="filters">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>{t("c.search")}</label>
            <input placeholder={t("d.searchPlaceholder")} value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <div className="field">
            <label>{t("c.seller")}</label>
            <select value={sellerId} onChange={(e) => { setSellerId(e.target.value); setPage(1); }}>
              <option value="">{t("c.all")}</option>
              {(data?.sellers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t("c.designer")}</label>
            <select value={designerId} onChange={(e) => { setDesignerId(e.target.value); setPage(1); }}>
              <option value="">{t("c.all")}</option>
              {(data?.designers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <DesignPager page={page} total={total} show={show} setPage={setPage} label={t("d.design")} />

      {/* Grid card */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))", gap: 18, marginTop: 14 }}>
        {designs.map((d) => (
          <div key={d.id} className="card design-card" onClick={() => openDetail(d.id)} style={{ overflow: "hidden", cursor: "pointer" }}>
            <div className="dc-img checker">
              {d.coverLabel && <span className="dc-side-badge">{(d.coverKind ? t(KIND_KEY[d.coverKind]) : "") || d.coverLabel}</span>}
              {(d.cover?.thumb || d.cover?.preview) ? (
                <img src={(d.cover.thumb ?? d.cover.preview)!} alt="" loading="lazy" decoding="async"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (d.cover?.preview && img.src !== d.cover.preview) img.src = d.cover.preview;
                    else { img.style.display = "none"; (img.nextElementSibling as HTMLElement)?.style.setProperty("display", "flex"); }
                  }} />
              ) : null}
              <div style={{ display: (d.cover?.thumb || d.cover?.preview) ? "none" : "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 12 }}>
                {d.cover?.status === "processing" ? t("d.processing") : t("d.noImage")}
              </div>
              <div className="dc-acts">
                {d.downloadUrl && (
                  <button className="dc-act" title={t("d.downloadOriginal")}
                    onClick={(e) => { e.stopPropagation(); forceDownload(d.downloadUrl!, d.title); }}>
                    <IconDownload width={16} height={16} />
                  </button>
                )}
              </div>
            </div>
            {/* Các mặt khác (mặt sau, mockup…) — thumbnail nhỏ dưới chân ảnh */}
            {d.sides && d.sides.length > 0 && (
              <div className="dc-sides">
                {d.sides.filter((s) => s.thumb).map((s) => (
                  <div key={s.id} className="dc-side" title={t(KIND_KEY[s.kind]) || s.label}>
                    <div className="dc-side-img checker"><img src={s.thumb!} alt={t(KIND_KEY[s.kind]) || s.label} loading="lazy" /></div>
                    <span>{t(KIND_KEY[s.kind]) || s.label}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="dc-body">
              <div className="dc-top">
                <span className="dc-id">
                  #{d.skuCode}
                  <button className="icon-btn" style={{ width: 18, height: 18, border: "none", background: "transparent", color: "inherit" }}
                    title={t("d.copy") + " ID"} onClick={(e) => { e.stopPropagation(); copyText(String(d.skuCode)); }}>
                    <IconCopy width={11} height={11} />
                  </button>
                </span>
                <span className="dc-date">{fmtDate(d.createdAt)}</span>
              </div>
              <div className="dc-title">
                <button className="icon-btn" title={t("d.copy") + " " + t("d.title").toLowerCase()}
                  onClick={(e) => { e.stopPropagation(); copyText(d.title); }}>
                  <IconCopy width={12} height={12} />
                </button>
                <span title={d.title}>{d.title}</span>
              </div>
              <div className="dc-meta"><span>{t("c.seller")}</span><b>{d.sellerName ?? "—"}</b></div>
              <div className="dc-meta"><span>{t("c.designer")}</span><b>{d.designerName ?? "—"}</b></div>
              <div className="dc-foot">
                <span>{d.dims ?? "—"}{d.sizeMB ? ` · ${d.sizeMB}MB` : ""}</span>
                <span>★ {d.avgScore != null && d.avgScore > 0 ? d.avgScore.toFixed(1) : "0"}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {!designs.length && <div className="panel empty">{t("d.noMatch")}</div>}
      <div style={{ marginTop: 16 }}><DesignPager page={page} total={total} show={show} setPage={setPage} label={t("d.design")} /></div>

      {sel && <DetailModal detail={sel} canEdit={canEdit} close={() => setSel(null)} reload={() => { load(); }} reopen={openDetail} flash={flash} doUpload={doUpload} />}
      {showCreate && <BulkUploadModal close={() => setShowCreate(false)} reload={load} flash={flash} doUpload={doUpload} sellers={data?.sellers ?? []} designers={data?.designers ?? []} />}
    </>
  );
}

function AddTile({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className="file-cell add-tile" type="button">
      <span className="add-plus">＋</span>
      <span className="add-label">{busy ? "…" : label}</span>
    </button>
  );
}

function DetailModal({ detail, canEdit, close, reload, reopen, flash, doUpload }: {
  detail: Detail; canEdit: boolean; close: () => void; reload: () => void;
  reopen: (id: string) => void; flash: (m: string) => void;
  doUpload: (designId: string, file: File, kind: string) => Promise<void>;
}) {
  const { t } = useLang();
  const d = detail.design;
  const [f, setF] = useState({
    title: d.title, description: d.description ?? "", points: d.points,
    personalize: d.personalize, personalization: d.personalization ?? "", productLink: d.productLink ?? "", note: d.note ?? "",
    platform: d.platform ?? "", tags: d.tags ?? [],
    sellerId: d.sellerId ?? "", storeId: d.storeId ?? "", designerId: d.designerId ?? "", creatorId: d.creatorId ?? "",
    listed: d.listed,
  });
  const [tagInput, setTagInput] = useState("");
  const [tab, setTab] = useState<"mockup" | "design" | "video">("design");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filesOf = (k: string) => k === "design"
    ? detail.files.filter((x) => x.kind === "design_front" || x.kind === "design_back")
    : detail.files.filter((x) => x.kind === (k === "mockup" ? "mockup" : "video"));

  const save = async () => {
    setBusy(true);
    const j = await fetch(`/api/designs/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }).then((r) => r.json());
    setBusy(false);
    if (j.ok) { flash(t("d.saved")); reload(); close(); } else flash("✗ " + (j.error ?? "Error"));
  };
  const del = async () => {
    if (!confirm(`#${d.skuCode} "${d.title}" — ${t("d.confirmDeleteDesign")}`)) return;
    const j = await fetch(`/api/designs/${d.id}`, { method: "DELETE" }).then((r) => r.json());
    if (j.ok) { flash(t("d.deleted")); reload(); close(); } else flash("✗ " + (j.error ?? "Error"));
  };
  const genAI = async () => {
    setAiBusy(true);
    const j = await fetch(`/api/designs/${d.id}/ai-info`, { method: "POST" }).then((r) => r.json());
    setAiBusy(false);
    if (j.ok) {
      setF({ ...f, title: j.title ?? f.title, description: j.description ?? f.description, tags: j.tags ?? f.tags });
      flash(j.source === "ai" ? t("d.aiDone") : t("d.aiTemplate") + (j.hint ? " — " + j.hint : ""));
    } else flash("✗ " + (j.error ?? "Error"));
  };
  const pendingKind = useRef("mockup");
  const [busyUp, setBusyUp] = useState(false);
  const pickAndUpload = (kind: string) => { pendingKind.current = kind; fileRef.current?.click(); };
  const onPicked = async (file: File) => {
    setBusyUp(true);
    try { await doUpload(d.id, file, pendingKind.current); flash(t("d.uploaded")); reopen(d.id); reload(); }
    catch (e) { flash("✗ " + (e as Error).message); }
    setBusyUp(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const delFile = async (fileId: string) => {
    if (!confirm(t("d.confirmDeleteFile"))) return;
    const j = await fetch(`/api/designs/files/${fileId}`, { method: "DELETE" }).then((r) => r.json());
    if (j.ok) { flash(t("d.fileDeleted")); reopen(d.id); } else flash("✗ " + (j.error ?? "Error"));
  };
  const retryFile = async (fileId: string) => {
    flash(t("d.retrying"));
    const j = await fetch("/api/designs/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId }) }).then((r) => r.json());
    if (j.ok) { flash(t("d.thumbCreated")); reopen(d.id); } else flash("✗ " + (j.error ?? "Error"));
  };
  const downloadAll = (rows: FileRow[]) => rows.forEach((x, i) => x.originalUrl && setTimeout(() => forceDownload(x.originalUrl!, `${d.title}-${x.kind}-${i + 1}`), i * 400));
  const copy = (v: string) => { navigator.clipboard?.writeText(v); flash(t("d.copied")); };

  const Sel = (k: "sellerId" | "storeId" | "designerId" | "creatorId", label: string, opts: Opt[]) => (
    <label style={rLbl}>{label}
      <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
  const CopyBtn = ({ v, tip }: { v: string; tip: string }) => (
    <button className="icon-btn" title={tip} onClick={() => copy(v)}><IconCopy width={12} height={12} /></button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={close}>
      <div style={{ background: "#fff", borderRadius: 18, width: 1180, maxWidth: "97vw", maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="dc-id" style={{ fontSize: 13 }}>#{d.skuCode}</span>
            <CopyBtn v={String(d.skuCode)} tip={t("d.copy") + " ID"} />
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{t("c.date")}: {fmtDate(String(d.createdAt))}</span>
          </div>
          <button onClick={close} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, padding: "12px 22px 16px", overflowY: "auto", flex: 1, minHeight: 0 }}>
          {/* CỘT TRÁI */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <b style={{ fontSize: 13.5 }}>{t("d.title")}</b>
              <CopyBtn v={f.title} tip={t("d.copy") + " " + t("d.title").toLowerCase()} />
              {canEdit && (
                <button onClick={genAI} disabled={aiBusy} style={{ ...btnDark, display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                  <IconSparkle width={13} height={13} /> {aiBusy ? t("d.generating") : t("d.genAI")}
                </button>
              )}
            </div>
            <input value={f.title} maxLength={140} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }} />
            <div style={{ fontSize: 11, color: f.title.length >= 140 ? "var(--red)" : "var(--muted)", textAlign: "right", marginTop: 3 }}>{f.title.length}/140</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
              <label style={rLbl}>{t("d.sku")}
                <input value={d.skuCode} readOnly style={{ ...inp, width: "100%", marginTop: 4, background: "#EDEFF4", color: "var(--muted)" }} />
              </label>
              <label style={rLbl}>{t("d.points")}
                <input type="number" min={0} max={10} value={f.points} disabled={!canEdit}
                  onChange={(e) => setF({ ...f, points: Number(e.target.value) })} style={{ ...inp, width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 4px" }}>
              <b style={{ fontSize: 13.5 }}>{t("d.description")}</b>
              <CopyBtn v={f.description} tip={t("d.copy") + " " + t("d.description").toLowerCase()} />
            </div>
            <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} disabled={!canEdit} rows={3} style={{ ...inp, width: "100%", resize: "vertical" }} />

            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={f.personalize} disabled={!canEdit} onChange={(e) => setF({ ...f, personalize: e.target.checked })} />
              {t("d.personalize")}
            </label>
            {f.personalize && (
              <div style={{ marginBottom: 6 }}>
                <b style={{ fontSize: 13, display: "block", marginBottom: 5 }}>{t("d.personalizationText")}</b>
                <textarea value={f.personalization} maxLength={256} onChange={(e) => setF({ ...f, personalization: e.target.value })} disabled={!canEdit}
                  rows={2} placeholder={t("d.personalizationPh")} style={{ ...inp, width: "100%", resize: "vertical" }} />
                <div style={{ fontSize: 11, color: f.personalization.length >= 256 ? "var(--red)" : "var(--muted)", textAlign: "right", marginTop: 3 }}>{f.personalization.length}/256</div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 4 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <b style={{ fontSize: 13 }}>{t("d.productLink")}</b>
                  {f.productLink && <CopyBtn v={f.productLink} tip={t("d.copy") + " link"} />}
                </div>
                <input value={f.productLink} placeholder={t("d.linkPlaceholder")} disabled={!canEdit}
                  onChange={(e) => setF({ ...f, productLink: e.target.value })} style={{ ...inp, width: "100%" }} />
              </div>
              <label style={{ ...rLbl }}>{t("c.note")}
                <input value={f.note} placeholder={t("c.note")} disabled={!canEdit}
                  onChange={(e) => setF({ ...f, note: e.target.value })} style={{ ...inp, width: "100%", marginTop: 4 }} />
              </label>
            </div>

            {/* Tabs files */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 10 }}>
              <div className="ftabs">
                {([["mockup", t("d.mockups")], ["design", t("d.designFiles")], ["video", t("d.videos")]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} className={`ftab${tab === k ? " on" : ""}`}>{label} ({filesOf(k).length})</button>
                ))}
              </div>
              {filesOf(tab).length > 1 && (
                <button onClick={() => downloadAll(filesOf(tab))} style={{ ...btnGhostBlue, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <IconDownload width={14} height={14} /> {t("d.downloadAll")}
                </button>
              )}
            </div>

            <div className="file-grid">
              {filesOf(tab).map((x) => (
                <div key={x.id} className="file-item">
                  <div className="file-cell checker">
                    <span className="file-kind">{t(KIND_KEY[x.kind]) || x.kind}</span>
                    {x.thumbUrl || x.originalUrl
                      ? <img src={x.thumbUrl ?? x.originalUrl!} alt="" loading="lazy" />
                      : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 11, color: "var(--muted)" }}>{x.kind === "video" ? "video" : "…"}</div>}
                    <span className="file-badge">{x.width && x.height ? `${x.width}×${x.height} · ` : ""}{(x.sizeBytes / 1048576).toFixed(1)}MB</span>
                  </div>
                  <div className="file-cap">
                    {x.filename && <div className="fn" title={x.filename}>{x.filename}</div>}
                    <div className="kw">{t(KIND_KEY[x.kind]) || x.kind}{x.uploaderName ? ` · ${x.uploaderName}` : ""}</div>
                    <div className="file-actions">
                      {x.originalUrl && <button className="fa-btn" title={t("d.downloadOriginal")} onClick={() => forceDownload(x.originalUrl!, x.filename || `${d.title}-${x.kind}`)}><IconDownload width={14} height={14} /></button>}
                      {x.originalUrl && <a href={x.originalUrl} target="_blank" rel="noreferrer" className="fa-btn" title={t("d.viewOriginal")}><IconEyeOpen width={14} height={14} /></a>}
                      {x.processingStatus === "failed" && <button className="fa-btn" title={t("d.retryThumb")} style={{ color: "var(--amber)" }} onClick={() => retryFile(x.id)}><IconRefresh width={14} height={14} /></button>}
                      {canEdit && <button className="fa-btn danger" title={t("c.delete")} onClick={() => delFile(x.id)}><IconTrash width={14} height={14} /></button>}
                    </div>
                  </div>
                </div>
              ))}
              {/* Ô ＋ upload theo tab */}
              {canEdit && tab === "mockup" && <AddTile label="Mockup" busy={busyUp} onClick={() => pickAndUpload("mockup")} />}
              {canEdit && tab === "video" && <AddTile label="Video" busy={busyUp} onClick={() => pickAndUpload("video")} />}
              {canEdit && tab === "design" && <>
                {!detail.files.some((x) => x.kind === "design_front") && <AddTile label={t("d.kindFront")} busy={busyUp} onClick={() => pickAndUpload("design_front")} />}
                {!detail.files.some((x) => x.kind === "design_back") && <AddTile label={t("d.kindBack")} busy={busyUp} onClick={() => pickAndUpload("design_back")} />}
              </>}
            </div>
            {filesOf(tab).length === 0 && !canEdit && (
              <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 0 2px" }}>{t("d.noFiles")}</div>
            )}
            <input ref={fileRef} type="file"
              accept={tab === "video" ? "video/*" : "image/*"}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) onPicked(file); }}
              style={{ display: "none" }} />
          </div>

          {/* CỘT PHẢI */}
          <div style={{ paddingBottom: 8 }}>
            <label style={rLbl}>{t("d.platform")}
              <select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }}>
                <option value="">{t("c.all")}</option>
                <option value="tiktok">TikTok</option><option value="amazon">Amazon</option><option value="etsy">Etsy</option>
              </select>
            </label>
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                {t("d.tags")} <span style={{ color: f.tags.length >= 13 ? "var(--red)" : "var(--muted)", fontWeight: 500, fontSize: 11.5 }}>({f.tags.length}/13)</span>
                <CopyBtn v={f.tags.join(", ")} tip={t("d.copy") + " tags"} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
                {f.tags.map((tag, i) => (
                  <span key={i} style={{ background: "var(--blue-soft)", color: "var(--blue)", borderRadius: 8, padding: "2px 9px", fontSize: 11.5, fontWeight: 600 }}>
                    {tag} {canEdit && <button onClick={() => setF({ ...f, tags: f.tags.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", padding: 0, fontSize: 11 }}>✕</button>}
                  </span>
                ))}
              </div>
              {canEdit && <input placeholder={f.tags.length >= 13 ? t("d.tagsFull") : t("d.addTag")} value={tagInput} maxLength={20}
                disabled={f.tags.length >= 13}
                onChange={(e) => setTagInput(e.target.value.slice(0, 20))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = tagInput.trim().slice(0, 20);
                    if (v && f.tags.length < 13 && !f.tags.includes(v)) { setF({ ...f, tags: [...f.tags, v] }); setTagInput(""); }
                  }
                }}
                style={{ ...inp, width: "100%", opacity: f.tags.length >= 13 ? 0.6 : 1 }} />}
            </div>
            <div style={{ marginTop: 9 }}>{Sel("sellerId", t("c.seller"), detail.sellers)}</div>
            <div style={{ marginTop: 9 }}>{Sel("storeId", t("c.store"), detail.stores)}</div>
            <div style={{ marginTop: 9 }}>{Sel("designerId", t("c.designer"), detail.designers)}</div>
            <div style={{ marginTop: 9 }}>{Sel("creatorId", t("d.creator"), detail.creators)}</div>

            <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>{t("d.statusListing")}</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer", fontSize: 13.5, fontWeight: 700 }}>
              <input type="checkbox" checked={f.listed} disabled={!canEdit} onChange={(e) => setF({ ...f, listed: e.target.checked })} />
              {f.listed ? t("d.listed") : t("d.unlisted")}
            </label>

            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, lineHeight: 1.8 }}>
              {t("d.ordersGenerated")}: <b style={{ color: "var(--ink)" }}>{detail.ordersGenerated.c}</b> ({detail.ordersGenerated.items} {t("c.items")})
              <br />{t("d.score")}: <b style={{ color: "var(--ink)" }}>{detail.avgScore ? detail.avgScore.toFixed(1) : "—"}</b> ({detail.reviewCount} {t("d.reviews")})
            </div>

            {canEdit && <button onClick={save} disabled={busy} style={{ ...btnGreen, width: "100%", marginTop: 10 }}>{busy ? t("c.saving") : t("c.save")}</button>}
            {canEdit && <button onClick={del} style={{ ...btnRed, width: "100%", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><IconTrash width={14} height={14} /> {t("d.deleteDesign")}</button>}
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "12px 24px", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={close} style={btnBlue}>{t("c.close")}</button>
        </div>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px", fontSize: 13, background: "#fff" };
const rLbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, display: "block" };
const btnBlue: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const btnDark: React.CSSProperties = { background: "#39404E", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const btnGreen: React.CSSProperties = { background: "var(--green)", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnRed: React.CSSProperties = { background: "var(--red)", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnGhostBlue: React.CSSProperties = { background: "#fff", color: "var(--blue)", border: "1px solid var(--blue)", borderRadius: 9, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const btnGhostBtn: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 9, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const pgBtn: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", borderRadius: 9, minWidth: 32, height: 32, fontSize: 13, cursor: "pointer", color: "var(--ink)" };

function DesignPager({ page, total, show, setPage, label }: { page: number; total: number; show: number; setPage: (n: number) => void; label: string }) {
  const pages = Math.max(Math.ceil(total / show), 1);
  const nums: (number | "…")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
      <button onClick={() => setPage(Math.max(1, page - 1))} style={pgBtn}>‹</button>
      {nums.map((n, i) => n === "…" ? <span key={i} style={{ color: "var(--muted)" }}>…</span> : (
        <button key={i} onClick={() => setPage(n)} style={{ ...pgBtn, background: n === page ? "var(--blue)" : "#fff", color: n === page ? "#fff" : "var(--ink)", fontWeight: 700 }}>{n}</button>
      ))}
      <button onClick={() => setPage(Math.min(pages, page + 1))} style={pgBtn}>›</button>
      <span style={{ fontSize: 12.5, color: "var(--muted)", marginLeft: 6 }}>{total.toLocaleString()} {label}</span>
    </div>
  );
}

function BulkUploadModal({ close, reload, flash, doUpload, sellers, designers }: {
  close: () => void; reload: () => void; flash: (m: string) => void;
  doUpload: (designId: string, file: File, kind: string) => Promise<void>;
  sellers: Opt[]; designers: Opt[];
}) {
  const { t } = useLang();
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState("design_front");
  const [sellerId, setSellerId] = useState("");
  const [designerId, setDesignerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Preview object URL — tạo theo files, thu hồi khi đổi/unmount
  const previews = useMemo(() => files.map((fl) => fl.type.startsWith("image/") ? URL.createObjectURL(fl) : null), [files]);
  useEffect(() => () => { previews.forEach((u) => u && URL.revokeObjectURL(u)); }, [previews]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };
  const removeAt = (i: number) => setFiles((prev) => prev.filter((_, j) => j !== i));

  const cleanTitle = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();

  const run = async () => {
    if (!files.length) return;
    setBusy(true);
    setErrors([]);
    setProgress({ done: 0, total: files.length });
    let ok = 0;
    const errs: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const j = await fetch("/api/designs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: cleanTitle(files[i].name), sellerId: sellerId || null, designerId: designerId || null }),
        }).then((r) => r.json());
        if (!j.ok) throw new Error(j.error ?? "create error");
        await doUpload(j.design.id, files[i], kind);
        ok++;
      } catch (e) {
        errs.push(`${files[i].name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setErrors(errs);
    setBusy(false);
    flash(errs.length
      ? `⚠ ${ok}/${files.length} ${t("d.bulkPartial")} — ${errs.length} ${t("d.bulkFail")}`
      : `${t("d.bulkDone")} ${ok}/${files.length} design`);
    reload();
    if (ok === files.length) close();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={busy ? undefined : close}>
      <div style={{ background: "#fff", borderRadius: 18, width: 600, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <b style={{ fontSize: 15 }}>{t("d.bulkTitle")}</b>
          {!busy && <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
        </div>

        {/* Dropzone */}
        <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <div className={`dropzone${drag ? " drag" : ""}`}
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) addFiles(e.dataTransfer.files); }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--blue)", fontWeight: 700, fontSize: 13.5 }}>
            <IconUpload width={17} height={17} /> {t("d.chooseMany")}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{t("d.dragHint")}</div>
        </div>

        {/* Lưới preview */}
        {files.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: "var(--muted)", margin: "12px 0 8px" }}>{files.length} {t("d.filesSelected")}</div>
            <div className="bulk-grid">
              {files.map((fl, i) => (
                <div key={i} className="bulk-cell checker">
                  {previews[i]
                    ? <img src={previews[i]!} alt="" />
                    : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 10.5, color: "var(--muted)", fontWeight: 700 }}>{fl.name.split(".").pop()?.toUpperCase()}</div>}
                  {!busy && <button className="bulk-x" title={t("c.delete")} onClick={() => removeAt(i)}>✕</button>}
                  <span className="bulk-name">{fl.name}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Tuỳ chọn */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14, marginBottom: 14 }}>
          <label style={rLbl}>{t("d.fileType")}
            <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy} style={{ ...inp, width: "100%", marginTop: 4 }}>
              {KINDS.filter(([k]) => k === "design_front" || k === "design_back").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label style={rLbl}>{t("c.seller")} <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 11 }}>{t("d.applyAll")}</span>
            <select value={sellerId} onChange={(e) => setSellerId(e.target.value)} disabled={busy} style={{ ...inp, width: "100%", marginTop: 4 }}>
              <option value="">—</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={rLbl}>{t("c.designer")}
            <select value={designerId} onChange={(e) => setDesignerId(e.target.value)} disabled={busy} style={{ ...inp, width: "100%", marginTop: 4 }}>
              <option value="">—</option>
              {designers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>

        {progress && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ height: 8, background: "var(--line)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: "100%", background: "var(--primary-grad)", transition: "width .2s" }} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, textAlign: "center" }}>{progress.done}/{progress.total} design</div>
          </div>
        )}

        {errors.length > 0 && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F5B5B5", borderRadius: 8, maxHeight: 140, overflowY: "auto" }}>
            <b style={{ fontSize: 12.5, color: "var(--red)" }}>{t("d.uploadErrors")} ({errors.length}):</b>
            {errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: "#8A2E2E", marginTop: 4, wordBreak: "break-word" }}>• {e}</div>)}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 16 }}>{t("d.bulkHint")}</div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {!busy && <button onClick={close} style={btnGhostBtn}>{t("c.cancel")}</button>}
          <button onClick={run} disabled={busy || !files.length} style={{ ...btnBlue, opacity: busy || !files.length ? 0.6 : 1 }}>
            {busy ? t("d.uploading") : `${t("d.upload")} ${files.length || ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
