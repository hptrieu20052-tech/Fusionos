"use client";
import { useCallback, useEffect, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { useLang } from "@/components/lang-provider";

type FileRow = { id: string; kind: string; thumbUrl: string | null; previewUrl: string | null; originalUrl: string | null; processingStatus: string; sizeBytes: number; width: number | null; height: number | null };
type Design = {
  id: string; skuCode: number; title: string; description: string | null; points: number;
  tags: string[]; personalize: boolean; productLink: string | null; note: string | null;
  platform: string | null; listed: boolean; createdAt: string;
  sellerId: string | null; designerId: string | null; creatorId: string | null; storeId: string | null;
  sellerName: string | null; designerName: string | null; creatorName: string | null; storeName?: string | null;
  avgScore: number | null; dims: string | null; sizeMB: string | null; downloadUrl: string | null;
  filesCount: number; cover: { thumb: string | null; preview: string | null; original: string | null; status: string } | null;
};
type Opt = { id: string; name: string };
type Detail = {
  design: Design & Record<string, unknown>; files: FileRow[];
  ordersGenerated: { c: number; items: number }; avgScore: number; reviewCount: number;
  sellers: Opt[]; designers: Opt[]; creators: Opt[]; stores: Opt[];
};

const KINDS: [string, string][] = [["mockup", "Mockup"], ["design_front", "Design Front"], ["design_back", "Design Back"], ["video", "Video"]];
const fmtDate = (s: string) => new Date(s).toISOString().slice(0, 16).replace("T", " ");

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
  const [busy, setBusy] = useState(false);
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
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2600); };

  // Flow upload 5 bước có sẵn
  async function doUpload(designId: string, file: File, kind: string) {
    const t = await fetch("/api/designs/upload-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, filename: file.name, contentType: file.type || "application/octet-stream", kind }),
    }).then((r) => r.json());
    if (!t.ok) throw new Error(t.error ?? "upload-url lỗi");
    await fetch(t.url, { method: t.method ?? "PUT", headers: t.headers ?? {}, body: file });
    const buf = await file.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const reg = await fetch("/api/designs/register-file", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId, kind, storageKey: t.storageKey, sha256: hash, sizeBytes: file.size, contentType: file.type }),
    }).then((r) => r.json());
    if (!reg.ok) throw new Error(reg.error ?? "register lỗi");
    if (!reg.deduped) await fetch("/api/designs/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: reg.file.id }) });
  }

  const openDetail = async (id: string) => {
    const j = await fetch(`/api/designs/${id}`).then((r) => r.json());
    if (j.ok) setSel(j);
  };


  return (
    <>
      {msg && <div style={{ position: "fixed", top: 16, right: 16, zIndex: 100, background: "#2A303C", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13.5 }}>{msg}</div>}

      {/* Page head: nút tạo design */}
      <div className="page-head">
        <div className="page-actions">
          <DateRangePicker value={dr ?? { range: "" }} onChange={(v) => { setDr(v); setPage(1); }} align="right" allowClear onClear={() => { setDr(null); setPage(1); }} />
          {canEdit && <button onClick={() => setShowCreate(true)} className="btn btn-primary">{t("d.bulkUpload")}</button>}
        </div>
      </div>

      {/* Bộ lọc có label */}
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
              <option value="">Tất cả</option>
              {(data?.sellers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t("c.designer")}</label>
            <select value={designerId} onChange={(e) => { setDesignerId(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(data?.designers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

        </div>
      </div>

      {/* Phân trang trên */}
      <DesignPager page={page} total={total} show={show} setPage={setPage} />

      {/* Grid card */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 18, marginTop: 14 }}>
        {designs.map((d) => (
          <div key={d.id} className="card design-card" onClick={() => openDetail(d.id)}
            style={{ overflow: "hidden", display: "flex", flexDirection: "column", cursor: "pointer" }}>
            <div style={{ position: "relative", aspectRatio: "1/1", background: "#EDEFF4" }}>
              {d.cover?.preview || d.cover?.thumb || d.cover?.original
                ? <img src={(d.cover.preview ?? d.cover.thumb ?? d.cover.original)!} alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      const img = e.currentTarget;
                      // preview/thumb lỗi → thử ảnh gốc; gốc cũng lỗi → ẩn, hiện placeholder
                      if (d.cover?.original && img.src !== d.cover.original) img.src = d.cover.original;
                      else { img.style.display = "none"; (img.nextElementSibling as HTMLElement)?.style.setProperty("display", "flex"); }
                    }} />
                : null}
              <div style={{ display: (d.cover?.preview || d.cover?.thumb || d.cover?.original) ? "none" : "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", fontSize: 12 }}>{d.cover?.status === "processing" ? "Đang xử lý…" : "Chưa có ảnh"}</div>
              {d.downloadUrl && (
                <a href={d.downloadUrl} download title="Tải file gốc" onClick={(e) => e.stopPropagation()}
                  style={{ position: "absolute", left: 0, bottom: 0, background: "#fff", borderTopRightRadius: 10, padding: "6px 12px", fontSize: 14, color: "var(--ink)", boxShadow: "0 -1px 6px rgba(42,48,60,.1)" }}>⇩</a>
              )}
            </div>
            <div style={{ padding: "10px 14px", fontSize: 12.5, lineHeight: 1.7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>ID: <b style={{ color: "var(--blue)" }}>{d.skuCode}</b> - Seller: <b>{d.sellerName ?? "—"}</b></span>
                <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(d.createdAt)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>Designer: <b>{d.designerName ?? "—"}</b></span>
                <span style={{ color: "var(--muted)" }}>{d.dims ?? ""} {d.sizeMB ? d.sizeMB + "MB" : ""}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>Creator: <b>{d.creatorName ?? ""}</b></span>
                <span>{d.avgScore != null && d.avgScore > 0 ? d.avgScore.toFixed(1) : "0"} ★</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 14, fontWeight: 600 }}>
                <button onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(d.title); flash("✓ Đã copy tên"); }} title="Copy tên" style={copyBtn}>⧉</button>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {!designs.length && <div className="panel empty">{t("d.noMatch")}</div>}
      <div style={{ marginTop: 16 }}><DesignPager page={page} total={total} show={show} setPage={setPage} /></div>

      {sel && <DetailModal detail={sel} canEdit={canEdit} close={() => setSel(null)} reload={() => { load(); }} reopen={openDetail} flash={flash} doUpload={doUpload} />}
      {showCreate && <BulkUploadModal close={() => setShowCreate(false)} reload={load} flash={flash} doUpload={doUpload} sellers={data?.sellers ?? []} designers={data?.designers ?? []} />}
    </>
  );
}

function DetailModal({ detail, canEdit, close, reload, reopen, flash, doUpload }: {
  detail: Detail; canEdit: boolean; close: () => void; reload: () => void;
  reopen: (id: string) => void; flash: (m: string) => void;
  doUpload: (designId: string, file: File, kind: string) => Promise<void>;
}) {
  const d = detail.design;
  const [f, setF] = useState({
    title: d.title, description: d.description ?? "", points: d.points,
    personalize: d.personalize, productLink: d.productLink ?? "", note: d.note ?? "",
    platform: d.platform ?? "", tags: d.tags ?? [],
    sellerId: d.sellerId ?? "", storeId: d.storeId ?? "", designerId: d.designerId ?? "", creatorId: d.creatorId ?? "",
    listed: d.listed,
  });
  const [tagInput, setTagInput] = useState("");
  const [tab, setTab] = useState<"mockup" | "design" | "video">("mockup");
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upKind, setUpKind] = useState("mockup");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const filesOf = (t: string) => t === "design"
    ? detail.files.filter((x) => x.kind === "design_front" || x.kind === "design_back")
    : detail.files.filter((x) => x.kind === (t === "mockup" ? "mockup" : "video"));

  const save = async () => {
    setBusy(true);
    const j = await fetch(`/api/designs/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }).then((r) => r.json());
    setBusy(false);
    if (j.ok) { flash("✓ Đã lưu"); reload(); close(); } else flash("✗ " + (j.error ?? "Lỗi"));
  };
  const del = async () => {
    if (!confirm(`Xoá design #${d.skuCode} "${d.title}"? Toàn bộ files sẽ mất.`)) return;
    const j = await fetch(`/api/designs/${d.id}`, { method: "DELETE" }).then((r) => r.json());
    if (j.ok) { flash("✓ Đã xoá"); reload(); close(); } else flash("✗ " + (j.error ?? "Lỗi"));
  };
  const genAI = async () => {
    setAiBusy(true);
    const j = await fetch(`/api/designs/${d.id}/ai-info`, { method: "POST" }).then((r) => r.json());
    setAiBusy(false);
    if (j.ok) {
      setF({ ...f, title: j.title ?? f.title, description: j.description ?? f.description, tags: j.tags ?? f.tags });
      flash(j.source === "ai" ? "✓ AI đã tạo info" : "✓ Đã tạo theo mẫu" + (j.hint ? " — " + j.hint : ""));
    } else flash("✗ " + (j.error ?? "Lỗi"));
  };
  const upload = async () => {
    if (!upFile) return;
    setBusy(true);
    try { await doUpload(d.id, upFile, upKind); flash("✓ Đã upload"); setUpFile(null); reopen(d.id); reload(); }
    catch (e) { flash("✗ " + (e as Error).message); }
    setBusy(false);
  };
  const delFile = async (fileId: string) => {
    if (!confirm("Xoá file này?")) return;
    const j = await fetch(`/api/designs/files/${fileId}`, { method: "DELETE" }).then((r) => r.json());
    if (j.ok) { flash("✓ Đã xoá file"); reopen(d.id); } else flash("✗ " + (j.error ?? "Lỗi"));
  };
  const downloadAll = (rows: FileRow[]) => rows.forEach((x, i) => x.originalUrl && setTimeout(() => { const a = document.createElement("a"); a.href = x.originalUrl!; a.download = ""; a.click(); }, i * 350));
  const copy = (t: string) => { navigator.clipboard?.writeText(t); flash("✓ Đã copy"); };

  const Sel = (k: "sellerId" | "storeId" | "designerId" | "creatorId", label: string, opts: Opt[]) => (
    <label style={rLbl}>{label}:
      <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(42,48,60,.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={close}>
      <div style={{ background: "#fff", borderRadius: 16, width: 1060, maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px 0" }}>
          <button onClick={close} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 26, padding: "0 26px", overflowY: "auto" }}>
          {/* CỘT TRÁI */}
          <div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Date: {fmtDate(String(d.createdAt))}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 4px" }}>
              <button onClick={() => copy(f.title)} title="Copy title" style={copyBtn}>⧉</button>
              <b style={{ fontSize: 13.5 }}>Title</b>
              {canEdit && <button onClick={genAI} disabled={aiBusy} style={btnDark}>{aiBusy ? "Đang tạo…" : "Generate Info By AI"}</button>}
            </div>
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
              <label style={rLbl}>Sku
                <input value={d.skuCode} readOnly style={{ ...inp, width: "100%", marginTop: 4, background: "#EDEFF4", color: "var(--muted)" }} />
              </label>
              <label style={rLbl}>Points
                <input type="number" min={0} max={10} value={f.points} disabled={!canEdit}
                  onChange={(e) => setF({ ...f, points: Number(e.target.value) })} style={{ ...inp, width: "100%", marginTop: 4 }} />
              </label>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 4px" }}>
              <button onClick={() => copy(f.description)} title="Copy description" style={copyBtn}>⧉</button>
              <b style={{ fontSize: 13.5 }}>Description</b>
            </div>
            <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} disabled={!canEdit} rows={4} style={{ ...inp, width: "100%", resize: "vertical" }} />

            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={f.personalize} disabled={!canEdit} onChange={(e) => setF({ ...f, personalize: e.target.checked })} />
              Personalize Product
            </label>

            <label style={rLbl}>Product Link
              <input value={f.productLink} placeholder="Link Product on Platform" disabled={!canEdit}
                onChange={(e) => setF({ ...f, productLink: e.target.value })} style={{ ...inp, width: "100%", marginTop: 4 }} />
            </label>
            <label style={{ ...rLbl, display: "block", marginTop: 10 }}>Note
              <textarea value={f.note} placeholder="Note" disabled={!canEdit} rows={2}
                onChange={(e) => setF({ ...f, note: e.target.value })} style={{ ...inp, width: "100%", marginTop: 4, resize: "vertical" }} />
            </label>

            {/* Tabs files */}
            <div style={{ display: "flex", gap: 0, marginTop: 16, borderBottom: "1px solid var(--line)" }}>
              {([["mockup", "Mockups"], ["design", "Designs"], ["video", "Videos"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} style={{
                  padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: "1px solid var(--line)", borderBottom: tab === k ? "2px solid #fff" : "none", marginBottom: -1,
                  borderRadius: "10px 10px 0 0", background: tab === k ? "#fff" : "#F5F6F9",
                  color: tab === k ? "var(--ink)" : "var(--blue)",
                }}>{label} ({filesOf(k).length})</button>
              ))}
            </div>
            <div style={{ padding: "14px 0 20px" }}>
              {tab === "mockup" && filesOf("mockup").length > 0 && (
                <button onClick={() => downloadAll(filesOf("mockup"))} style={{ ...btnGhostBlue, marginBottom: 12 }}>⇩ Download All Mockups</button>
              )}
              {filesOf(tab).map((x) => (
                <div key={x.id} style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
                  <div style={{ width: 96, height: 96, borderRadius: 10, background: "#EDEFF4", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {x.thumbUrl ? <img src={x.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "var(--muted)" }}>{x.kind === "video" ? "video" : "…"}</span>}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <b>{d.title}.{x.kind === "video" ? "MP4" : "PNG"}</b>
                    <div style={{ fontWeight: 700 }}>{x.kind} - {d.designerName ?? ""}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{x.width && x.height ? `${x.width}x${x.height} · ` : ""}{(x.sizeBytes / 1048576).toFixed(2)}MB · {x.processingStatus}</div>
                    <div style={{ display: "flex", gap: 12, marginTop: 3 }}>
                      {x.originalUrl && <a href={x.originalUrl} target="_blank" style={{ color: "var(--blue)", fontSize: 12.5 }}>View Orginal</a>}
                      {canEdit && <button onClick={() => delFile(x.id)} style={{ background: "none", border: "none", color: "var(--red)", fontSize: 12.5, cursor: "pointer", padding: 0 }}>Delete</button>}
                    </div>
                  </div>
                </div>
              ))}
              {!filesOf(tab).length && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Chưa có file.</div>}
              {canEdit && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input type="file" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12.5, flex: 1 }} />
                  <select value={upKind} onChange={(e) => setUpKind(e.target.value)} style={inp}>
                    {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <button onClick={upload} disabled={!upFile || busy} style={{ ...btnGhostGreen, opacity: !upFile || busy ? 0.5 : 1 }}>{busy ? "…" : "Upload"}</button>
                </div>
              )}
            </div>
          </div>

          {/* CỘT PHẢI */}
          <div style={{ paddingBottom: 20 }}>
            <label style={rLbl}>Platform:
              <select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} disabled={!canEdit} style={{ ...inp, width: "100%", marginTop: 4 }}>
                <option value="">All</option>
                <option value="tiktok">TikTok</option><option value="amazon">Amazon</option><option value="etsy">Etsy</option>
              </select>
            </label>
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                <button onClick={() => copy(f.tags.join(", "))} title="Copy tags" style={copyBtn}>⧉</button> Tags:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
                {f.tags.map((t, i) => (
                  <span key={i} style={{ background: "var(--blue-soft)", color: "var(--blue)", borderRadius: 8, padding: "2px 9px", fontSize: 11.5, fontWeight: 600 }}>
                    {t} {canEdit && <button onClick={() => setF({ ...f, tags: f.tags.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", padding: 0, fontSize: 11 }}>✕</button>}
                  </span>
                ))}
              </div>
              {canEdit && <input placeholder="Add tag…" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) { setF({ ...f, tags: [...f.tags, tagInput.trim()] }); setTagInput(""); } }}
                style={{ ...inp, width: "100%" }} />}
            </div>
            <div style={{ marginTop: 12 }}>{Sel("sellerId", "Seller", detail.sellers)}</div>
            <div style={{ marginTop: 12 }}>{Sel("storeId", "Store", detail.stores)}</div>
            <div style={{ marginTop: 12 }}>{Sel("designerId", "Designer", detail.designers)}</div>
            <div style={{ marginTop: 12 }}>{Sel("creatorId", "Creator", detail.creators)}</div>

            <div style={{ marginTop: 14, fontSize: 13, fontWeight: 600 }}>Status(Listing):</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer", fontSize: 13.5, fontWeight: 700 }}>
              <input type="checkbox" checked={f.listed} disabled={!canEdit} onChange={(e) => setF({ ...f, listed: e.target.checked })} />
              {f.listed ? "listed" : "unlist"}
            </label>

            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
              Đơn phát sinh: <b style={{ color: "var(--ink)" }}>{detail.ordersGenerated.c}</b> ({detail.ordersGenerated.items} items)
              · Điểm: <b style={{ color: "var(--ink)" }}>{detail.avgScore ? detail.avgScore.toFixed(1) : "—"}</b> ({detail.reviewCount} lượt chấm)
            </div>

            {canEdit && <button onClick={save} disabled={busy} style={{ ...btnGreen, width: "100%", marginTop: 14 }}>Save</button>}
            {canEdit && <button onClick={del} style={{ ...btnRed, width: "100%", marginTop: 8 }}>Delete</button>}
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", padding: "12px 26px", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={close} style={btnBlue}>Close</button>
        </div>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px", fontSize: 13, background: "#fff" };
const rLbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, display: "block" };
const copyBtn: React.CSSProperties = { background: "none", border: "1px solid var(--line)", borderRadius: 6, padding: "1px 6px", fontSize: 12, cursor: "pointer", color: "var(--muted)" };
const btnBlue: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const btnDark: React.CSSProperties = { background: "#5A6272", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const btnGreen: React.CSSProperties = { background: "var(--green)", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnRed: React.CSSProperties = { background: "var(--red)", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnGhostBlue: React.CSSProperties = { background: "#fff", color: "var(--blue)", border: "1px solid var(--blue)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const btnGhostGreen: React.CSSProperties = { background: "#fff", color: "var(--green)", border: "1px solid var(--green)", borderRadius: 8, padding: "7px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

function DesignPager({ page, total, show, setPage }: { page: number; total: number; show: number; setPage: (n: number) => void }) {
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
      <span style={{ fontSize: 12.5, color: "var(--muted)", marginLeft: 6 }}>{total.toLocaleString()} design</span>
    </div>
  );
}

function BulkUploadModal({ close, reload, flash, doUpload, sellers, designers }: {
  close: () => void; reload: () => void; flash: (m: string) => void;
  doUpload: (designId: string, file: File, kind: string) => Promise<void>;
  sellers: Opt[]; designers: Opt[];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState("design_front");
  const [sellerId, setSellerId] = useState("");
  const [designerId, setDesignerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const cleanTitle = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();

  const run = async () => {
    if (!files.length) return;
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        const j = await fetch("/api/designs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: cleanTitle(files[i].name), sellerId: sellerId || null, designerId: designerId || null }),
        }).then((r) => r.json());
        if (j.ok) { await doUpload(j.design.id, files[i], kind); ok++; }
      } catch { /* bỏ qua file lỗi, tiếp tục */ }
      setProgress({ done: i + 1, total: files.length });
    }
    setBusy(false);
    flash(`✓ Đã tạo ${ok}/${files.length} design`);
    reload();
    if (ok === files.length) close();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(42,48,60,.45)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={busy ? undefined : close}>
      <div style={{ background: "#fff", borderRadius: 16, width: 560, maxWidth: "95vw", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <b style={{ fontSize: 15 }}>Bulk upload — mỗi file thành 1 design</b>
          {!busy && <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Chọn nhiều file thiết kế</label>
        <input type="file" multiple disabled={busy} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} style={{ fontSize: 12.5, marginBottom: 6 }} />
        {files.length > 0 && (
          <div style={{ maxHeight: 150, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: 12.5 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: "var(--muted)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ <b style={{ color: "var(--ink)" }}>{cleanTitle(f.name)}</b></span>
                <span>{(f.size / 1048576).toFixed(1)}MB</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Loại file
            <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy} style={{ ...inp, width: "100%", marginTop: 4 }}>
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Seller (áp cho tất cả)
            <select value={sellerId} onChange={(e) => setSellerId(e.target.value)} disabled={busy} style={{ ...inp, width: "100%", marginTop: 4 }}>
              <option value="">—</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Designer
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

        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 16 }}>Tên design lấy từ tên file (bỏ đuôi, đổi _ thành khoảng trắng). ID cấp tự động theo thứ tự. Mở "More" từng design để bổ sung thông tin sau.</div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {!busy && <button onClick={close} style={btnGhostBtn}>Huỷ</button>}
          <button onClick={run} disabled={busy || !files.length} style={{ ...btnBlue, opacity: busy || !files.length ? 0.6 : 1 }}>
            {busy ? "Đang upload…" : `Upload ${files.length || ""} file`}
          </button>
        </div>
      </div>
    </div>
  );
}

const pgBtn: React.CSSProperties = { minWidth: 34, height: 34, border: "1px solid var(--line)", borderRadius: 9, background: "#fff", cursor: "pointer", fontSize: 13, color: "var(--ink)" };
const btnGhostBtn: React.CSSProperties = { background: "#fff", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
