"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";

/**
 * v449 · Meta Ads Center — đọc bảng meta_insights (cron đồng bộ nền), gộp theo campaign → ad,
 * cột số tính client. Nút 🤖 AI Analyze gọi POST /api/meta-ads/insights → nhận định + đề xuất.
 */
type Row = {
  day: string; campaignId: string; campaignName: string | null; adsetId: string; adsetName: string | null;
  adId: string; adName: string | null; spend: string | null; impressions: number | null; clicks: number | null;
  linkClicks: number | null; atc: number | null; purchases: number | null; revenue: string | null;
};
type AiAction = { ad: string; adId?: string; adsetId?: string; action: string; reason: string };
type Ai = { summary?: string; winners?: string[]; losers?: string[]; actions?: AiAction[]; nextTest?: string };

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const money = (n: number) => "$" + n.toFixed(2);
const num = (n: number) => n.toLocaleString();
// v457 · công tắc bật/tắt (arm 2 bước: bấm 1 = Confirm? màu cam, bấm 2 = thực thi).
function Toggle({ on, armed, busy, onClick, title, dim }: { on: boolean; armed: boolean; busy: boolean; onClick: () => void; title?: string; dim?: boolean }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={busy}
      title={title ?? (dim ? "Tầng cha đang OFF — mục này KHÔNG chạy dù công tắc riêng vẫn bật" : on ? "Đang ON — bấm 2 lần để tắt" : "Đang OFF — bấm 2 lần để bật")}
      style={{ border: "none", cursor: "pointer", borderRadius: 999, padding: 0, width: 34, height: 18, position: "relative", flexShrink: 0, verticalAlign: "middle",
        background: armed ? "#F59E0B" : on ? "#16A34A" : "#CBD5E1", transition: "background .15s", opacity: busy ? .55 : dim ? .45 : 1 }}>
      <span style={{ position: "absolute", top: 2, left: armed ? 10 : on ? 18 : 2, width: 14, height: 14, borderRadius: 999, background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.25)" }} />
    </button>
  );
}

const ACTION_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  keep: { bg: "#E9F7EF", fg: "#1F6F45", label: "KEEP" },
  raise_budget: { bg: "#E7F0FF", fg: "#1D4ED8", label: "RAISE $" },
  lower_budget: { bg: "#FEF6E7", fg: "#B7791F", label: "LOWER $" },
  pause: { bg: "#FEE4E2", fg: "#B42318", label: "PAUSE" },
  new_creative: { bg: "#F3E8FF", fg: "#7E22CE", label: "NEW CREATIVE" },
  watch: { bg: "#F1F1F4", fg: "#5B6472", label: "WATCH" },
};

export default function AdsCenterClient() {
  // v453 · DateRangePicker chung của FUSION (preset + lịch chọn khoảng, giống Ads Manager).
  const [dr, setDr] = useState<RangeValue>({ range: "7d" });
  const [rows, setRows] = useState<Row[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  // v451 · trạng thái campaign + filter + thu gọn từng campaign (nhớ localStorage).
  const [campStatus, setCampStatus] = useState<Record<string, string>>({});
  // v531 · danh sách đủ campaign từ meta_campaigns — để campaign MỚI (chưa chi tiêu) vẫn hiện trong bảng.
  const [campList, setCampList] = useState<{ id: string; name: string; status: string }[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCamp = (id: string, cur: boolean) => {
    setCollapsed((m) => { const n = { ...m, [id]: !cur }; try { localStorage.setItem("metaads.collapsed", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  };
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState<Ai | null>(null);
  const [err, setErr] = useState("");
  // v450b · chọn model AI (danh sách chung của FUSION; trống = default server). Nhớ qua localStorage.
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [aiModel, setAiModel] = useState("");
  useEffect(() => {
    try { const m = localStorage.getItem("metaads.model"); if (m) setAiModel(m); } catch { /* ignore */ }
    try { setCollapsed(JSON.parse(localStorage.getItem("metaads.collapsed") ?? "{}")); } catch { /* ignore */ }
    fetch("/api/books/models?type=text").then((r) => r.json()).then((j) => { if (Array.isArray(j?.models)) setAiModels(j.models); }).catch(() => { /* offline */ });
  }, []);
  const pickModel = (v: string) => { setAiModel(v); try { localStorage.setItem("metaads.model", v); } catch { /* ignore */ } };
  // v450 · Approve: bấm 2 lần để thực thi đề xuất (pause / ±20% budget) qua API.
  const [armIdx, setArmIdx] = useState(-1);
  const [applied, setApplied] = useState<Record<number, string>>({});
  const [applyBusy, setApplyBusy] = useState(-1);
  const applyAction = async (i: number, a: AiAction) => {
    if (applyBusy >= 0 || applied[i]) return;
    if (armIdx !== i) { setArmIdx(i); setTimeout(() => setArmIdx((c) => (c === i ? -1 : c)), 4000); return; }
    setArmIdx(-1); setApplyBusy(i);
    try {
      const j = await fetch("/api/meta-ads/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a.action, adId: a.adId, adsetId: a.adsetId }) }).then((r) => r.json());
      if (j.ok) { setApplied((m) => ({ ...m, [i]: j.did ?? "done" })); loadEnt(); }  // v457 · refresh toggle/budget sau khi AI apply
      else setErr(j.error ?? "Apply failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setApplyBusy(-1);
  };

  // v457 · điều khiển trực tiếp: trạng thái CẤU HÌNH + budget thật từ Meta (route /entities).
  // v462 · ads kèm thumbnail creative: thumb (512px, hiện nhỏ trong bảng) + img (ảnh gốc để zoom).
  type AdEnt = { status: string; eff?: string; thumb?: string | null; img?: string | null; name?: string; adsetId?: string; campId?: string; plink?: string | null };
  type Ent = { camp: Record<string, string>; adsets: Record<string, { status: string; eff?: string; budget: number; name?: string; campId?: string }>; ads: Record<string, AdEnt> };
  const [ent, setEnt] = useState<Ent | null>(null);
  const loadEnt = useCallback(async () => {
    try {
      const j = await fetch("/api/meta-ads/entities").then((r) => r.json());
      if (j.ok) {
        // Chịu được cả shape cũ (id → status string) lẫn mới (id → {status, thumb, img}) — an toàn lúc deploy lệch nhịp.
        const ads: Record<string, AdEnt> = {};
        for (const [k, v] of Object.entries((j.ads ?? {}) as Record<string, unknown>)) ads[k] = typeof v === "string" ? { status: v } : (v as AdEnt);
        setEnt({ camp: j.camp ?? {}, adsets: j.adsets ?? {}, ads });
      }
    } catch { /* điều khiển là phụ — lỗi không chặn bảng số */ }
  }, []);
  useEffect(() => { loadEnt(); }, [loadEnt]);

  const [ctlArm, setCtlArm] = useState("");
  const [ctlBusy, setCtlBusy] = useState("");
  // Mọi hành động điều khiển đều arm 2 bước (giống Approve) — chống bấm nhầm bật/tắt tiền thật.
  const ctl = async (key: string, payload: Record<string, unknown>, after: () => void) => {
    if (ctlBusy) return;
    if (ctlArm !== key) { setCtlArm(key); setTimeout(() => setCtlArm((c) => (c === key ? "" : c)), 4000); return; }
    setCtlArm(""); setCtlBusy(key); setErr("");
    try {
      const j = await fetch("/api/meta-ads/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());
      if (j.ok) after(); else setErr(j.error ?? "Action failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setCtlBusy("");
  };
  const toggleStatus = (level: "camp" | "adset" | "ad", id: string) => {
    if (!ent) return;
    const cur = level === "camp" ? ent.camp[id] : level === "adset" ? ent.adsets[id]?.status : ent.ads[id]?.status;
    const next = cur === "ACTIVE" ? "PAUSED" : "ACTIVE";
    ctl(level + ":" + id, { action: "set_status", id, status: next }, () => {
      setEnt((e) => {
        if (!e) return e;
        if (level === "camp") return { ...e, camp: { ...e.camp, [id]: next } };
        if (level === "adset") return { ...e, adsets: { ...e.adsets, [id]: { ...e.adsets[id], status: next } } };
        return { ...e, ads: { ...e.ads, [id]: { ...e.ads[id], status: next } } };
      });
    });
  };
  // v462 · lightbox phóng to creative — click ảnh nhỏ trong bảng.
  const [zoom, setZoom] = useState("");
  // Sửa budget ad set: bấm ✎ → nhập số → ✓ (không cần arm — gõ số đã là hành động chủ đích).
  const [budEdit, setBudEdit] = useState<{ id: string; val: string } | null>(null);
  const saveBudget = async (adsetId: string) => {
    const dollars = Number(budEdit?.val);
    if (!isFinite(dollars) || dollars <= 0) { setErr("Budget phải là số > 0"); return; }
    setCtlBusy("bud:" + adsetId); setErr("");
    try {
      const j = await fetch("/api/meta-ads/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_budget", adsetId, budget: dollars }) }).then((r) => r.json());
      if (j.ok) { setEnt((e) => e ? { ...e, adsets: { ...e.adsets, [adsetId]: { ...e.adsets[adsetId], budget: dollars } } } : e); setBudEdit(null); }
      else setErr(j.error ?? "Set budget failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setCtlBusy("");
  };

  const { from, to } = useMemo(() => rangeToDates(dr), [dr]);

  const load = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const j = await fetch(`/api/meta-ads/insights?from=${from}&to=${to}`).then((r) => r.json());
      if (j.ok) { setRows(j.rows ?? []); setLastSync(j.lastSyncAt); setCampStatus(j.campaignStatus ?? {}); setCampList(Array.isArray(j.campaignList) ? j.campaignList : []); }
      else setErr(j.error ?? "Load failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setBusy(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const syncNow = async () => {
    setSyncBusy(true); setErr("");
    try {
      const j = await fetch("/api/cron/meta-insights").then((r) => r.json());
      if (!j.ok) setErr(j.error ?? "Sync failed");
      await load();
    } catch (e) { setErr(String((e as Error).message)); }
    setSyncBusy(false);
  };

  const analyze = async () => {
    setAiBusy(true); setErr(""); setAi(null);
    try {
      const j = await fetch("/api/meta-ads/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to, model: aiModel || undefined }) }).then((r) => r.json());
      if (j.ok) setAi(j.ai as Ai); else setErr(j.error ?? "Analyze failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setAiBusy(false);
  };

  // v535 · Dup chuẩn FUSION: dup campaign / ad set / ad đều dẫn về BƯỚC CHỌN PRODUCT bên Shopify
  // (Meta Ads Kit) như luồng ＋ New campaign — copy KHUNG trên Meta rồi nhảy sang Manage Products.
  // Ô tick "copy kèm creative" giữ lại luồng copy y nguyên (Meta /copies) cho ai cần.
  const [dupBusy, setDupBusy] = useState("");
  const [dupForm, setDupForm] = useState<{ kind: "camp" | "adset" | "ad"; id: string; label: string; name: string; target: string; orig: string; budget: string; deep: boolean; adsetName: string; start: string } | null>(null);
  const dupCamp = (campId: string, campName: string) =>
    setDupForm({ kind: "camp", id: campId, label: campName || campId, name: `${campName} - Copy`, target: "", orig: "", budget: "", deep: false, adsetName: "", start: "" });
  const dupAdset = (adsetId: string, adsetName: string, campId: string) =>
    setDupForm({ kind: "adset", id: adsetId, label: adsetName || adsetId, name: `${adsetName} - Copy`, target: campId, orig: campId, budget: "", deep: false, adsetName, start: "" });
  const dupAd = (adId: string, adName: string, curAdsetId: string, curAdsetName: string) =>
    setDupForm({ kind: "ad", id: adId, label: adName || adId, name: `${adName} - Copy`, target: curAdsetId, orig: curAdsetId, budget: "", deep: false, adsetName: curAdsetName, start: "" });
  const submitDup = async () => {
    if (!dupForm || dupBusy) return;
    const f = dupForm;
    if (f.kind === "ad" && !f.target.trim()) { setErr("Ad set ID đích không được trống"); return; }
    setDupBusy(f.kind + ":" + f.id); setErr("");
    try {
      if (f.kind === "camp") {
        // Copy khung campaign → sang kit chọn product (push sẽ tạo ad set + ads vào campaign mới).
        const j = await fetch("/api/meta-ads/duplicate", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "campaign", id: f.id, name: f.name.trim() }) }).then((r) => r.json());
        if (j.ok && j.id) { window.location.href = `/shopify-products?adskit=1&campaignId=${j.id}&campaign=${encodeURIComponent(f.name.trim())}`; return; }
        setErr(j.ok ? "⚠ " + (j.warn ?? "Copied — check Ads Manager.") : "✗ " + (j.error ?? "Dup failed"));
      } else if (f.kind === "adset") {
        const j = await fetch("/api/meta-ads/duplicate", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "adset", id: f.id, campaignId: f.target.trim(), name: f.name.trim(), budget: Number(f.budget) || undefined, deep: f.deep,
            startTime: f.start ? new Date(f.start).toISOString() : undefined }) }).then((r) => r.json());
        if (!j.ok) { setErr("✗ " + (j.error ?? "Dup failed")); }
        else if (j.warn) { setErr(`⚠ ${j.warn}${j.id && !f.deep ? ` Ad set mới #${j.id} đã tạo — Sync xong bấm ＋ Ads trên nó để thêm ads.` : ""}`); setDupForm(null); loadEnt(); }
        else if (f.deep) { setErr(`✓ Đã dup ad set${j.id ? ` (#${j.id})` : ""} KÈM ads — PAUSED${f.start ? `, lịch chạy ${new Date(f.start).toLocaleString()}` : ""}. Bấm ⟳ Sync now để thấy, bật trong Ads Manager sau khi kiểm tra.`); setDupForm(null); loadEnt(); }
        else if (j.id) { window.location.href = `/shopify-products?adskit=1&adsetId=${j.id}&adset=${encodeURIComponent(f.name.trim())}`; return; }
        else setErr("⚠ " + (j.warn ?? "Copied — check Ads Manager."));
      } else {
        // kind === "ad"
        if (f.deep) {
          const j = await fetch("/api/meta-ads/duplicate", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "ad", id: f.id, adsetId: f.target.trim(), name: f.name.trim() }) }).then((r) => r.json());
          if (j.ok) { setErr(`✓ Đã dup ad${j.id ? ` (#${j.id})` : ""} — PAUSED. Bấm ⟳ Sync now để thấy.`); setDupForm(null); loadEnt(); }
          else setErr("✗ " + (j.error ?? "Dup failed"));
        } else {
          // Không cần gọi Meta — sang thẳng kit chọn product, push ad mới vào ad set đích.
          const nm = f.target.trim() === f.orig ? f.adsetName : ""; // tên chỉ đúng khi đích = ad set gốc
          window.location.href = `/shopify-products?adskit=1&adsetId=${f.target.trim()}${nm ? `&adset=${encodeURIComponent(nm)}` : ""}`;
          return;
        }
      }
    } catch (e) { setErr("✗ " + String((e as Error).message)); }
    setDupBusy("");
  };
  // v525 · nút hành động nhỏ dùng chung trên các hàng
  // v530 · đổi tên campaign / ad set / ad ngay tại bảng. v533 · sửa INLINE (như ô budget) —
  // bấm ✎ → tên thành ô nhập ngay tại chỗ, Enter/✓ lưu, Esc/✕ hủy. Không dùng window.prompt nữa.
  const [renBusy, setRenBusy] = useState("");
  const [renEdit, setRenEdit] = useState<{ kind: "camp" | "adset" | "ad"; id: string; val: string } | null>(null);
  const saveRename = async () => {
    if (!renEdit || renBusy) return;
    const { kind, id } = renEdit;
    const name = renEdit.val.trim();
    if (!name) { setErr("Tên không được để trống"); return; }
    setRenBusy(kind + ":" + id); setErr("");
    try {
      const j = await fetch("/api/meta-ads/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rename", id, name }) }).then((r) => r.json());
      if (j.ok) {
        // Đổi tên ngay trên bảng (không chờ sync) — meta_insights sẽ khớp lại ở lần sync sau.
        setRows((rs) => rs.map((r) =>
          kind === "camp" && r.campaignId === id ? { ...r, campaignName: name }
          : kind === "adset" && r.adsetId === id ? { ...r, adsetName: name }
          : kind === "ad" && r.adId === id ? { ...r, adName: name } : r));
        setCampList((cs) => kind === "camp" ? cs.map((c) => c.id === id ? { ...c, name } : c) : cs);
        setEnt((e) => e && kind === "adset" && e.adsets[id] ? { ...e, adsets: { ...e.adsets, [id]: { ...e.adsets[id], name } } }
          : e && kind === "ad" && e.ads[id] ? { ...e, ads: { ...e.ads, [id]: { ...e.ads[id], name } } } : e);
        setRenEdit(null);
      } else setErr(j.error ?? "Rename failed");
    } catch (e) { setErr(String((e as Error).message)); }
    setRenBusy("");
  };
  const renOkBtn: React.CSSProperties = { border: "none", background: "#16A34A", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer" };
  const renXBtn: React.CSSProperties = { border: "none", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" };
  const renInput = (width: number, fontSize: number): React.CSSProperties => ({ width, border: "1px solid #C9D2DE", borderRadius: 8, padding: "3px 8px", fontSize, fontWeight: 700, font: "inherit", outline: "none", background: "#fff" });
  const dupLbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#5B6472" };
  const dupInp: React.CSSProperties = { border: "1px solid #C9D2DE", borderRadius: 8, padding: "7px 10px", fontSize: 13, font: "inherit", outline: "none" };
  const rowBtn: React.CSSProperties = { border: "1px solid #C9D2DE", background: "#fff", color: "#1D4ED8", borderRadius: 999, padding: "1px 9px", fontSize: 10.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" };
  const penBtn: React.CSSProperties = { border: "none", background: "transparent", color: "#8794A5", fontSize: 12, cursor: "pointer", padding: "0 3px", flexShrink: 0, lineHeight: 1 };

  // Gộp theo campaign → ad
  const grouped = useMemo(() => {
    type Agg = { campId: string; campaign: string; ad: string; adId: string; adset: string; adsetId: string; spend: number; imp: number; lc: number; atc: number; pur: number; rev: number };
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const k = r.adId;
      const a = m.get(k) ?? { campId: r.campaignId, campaign: r.campaignName ?? "—", ad: r.adName ?? r.adId, adId: r.adId, adset: r.adsetName ?? "", adsetId: r.adsetId, spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 };
      a.spend += Number(r.spend) || 0; a.imp += r.impressions ?? 0; a.lc += r.linkClicks ?? 0;
      a.atc += r.atc ?? 0; a.pur += r.purchases ?? 0; a.rev += Number(r.revenue) || 0;
      m.set(k, a);
    }
    const byCamp = new Map<string, { name: string; ads: Agg[] }>();
    for (const a of Array.from(m.values())) {
      const g = byCamp.get(a.campId) ?? { name: a.campaign, ads: [] };
      g.ads.push(a); byCamp.set(a.campId, g);
    }
    // v532 · ads CHƯA CHI TIÊU (chưa có dòng insights nào trong khoảng ngày) — dựng từ cấu trúc thật
    // trên Meta (route /entities, có name + adset_id + campaign_id) với số liệu 0, để campaign/ad set
    // mới tạo vẫn thấy đủ ad set + ads như Ads Manager.
    const campName = new Map(campList.map((c) => [c.id, c.name]));
    for (const [adId, ad] of Object.entries(ent?.ads ?? {})) {
      if (m.has(adId)) continue;
      if (!ad.campId || !ad.adsetId) continue; // entities bản cũ (chưa deploy) — bỏ qua êm
      if (ad.status === "ARCHIVED" || ad.status === "DELETED") continue;
      m.set(adId, {
        campId: ad.campId, campaign: campName.get(ad.campId) || "—",
        ad: ad.name || adId, adId, adset: ent?.adsets[ad.adsetId]?.name ?? "", adsetId: ad.adsetId,
        spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0,
      });
      if (!byCamp.has(ad.campId)) byCamp.set(ad.campId, { name: campName.get(ad.campId) || "—", ads: [] });
      byCamp.get(ad.campId)!.ads.push(m.get(adId)!);
    }
    // v531 · campaign MỚI chưa chi tiêu (không có dòng insights) — vẫn hiện card rỗng để bấm ＋ Ads / bật tắt.
    for (const c of campList) {
      if (c.id && !byCamp.has(c.id)) byCamp.set(c.id, { name: c.name || "—", ads: [] });
    }
    // v454 · sắp theo AD SET (nhóm) rồi spend — render sẽ chèn hàng tiêu đề mỗi khi đổi ad set.
    for (const g of Array.from(byCamp.values())) g.ads.sort((x: Agg, y: Agg) => x.adset.localeCompare(y.adset) || y.spend - x.spend);
    return Array.from(byCamp.entries()).sort((x, y) => y[1].ads.reduce((s, a) => s + a.spend, 0) - x[1].ads.reduce((s, a) => s + a.spend, 0));
  }, [rows, campList, ent]);

  const totals = useMemo(() => {
    const t = { spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 };
    for (const r of rows) { t.spend += Number(r.spend) || 0; t.imp += r.impressions ?? 0; t.lc += r.linkClicks ?? 0; t.atc += r.atc ?? 0; t.pur += r.purchases ?? 0; t.rev += Number(r.revenue) || 0; }
    return t;
  }, [rows]);

  const th: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 10.5, fontWeight: 800, letterSpacing: ".3px", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 12.5, whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <b style={{ fontSize: 17 }}>📣 Meta Ads Center</b>
        <DateRangePicker value={dr} onChange={setDr} />
        {/* v451 · lọc campaign theo trạng thái thật từ Meta */}
        <div style={{ display: "flex", gap: 4, background: "#F1F3F6", borderRadius: 10, padding: 3 }}>
          {(["all", "active", "inactive"] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              style={{ border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: statusFilter === f ? "#fff" : "transparent", color: statusFilter === f ? "var(--ink)" : "var(--muted)",
                boxShadow: statusFilter === f ? "0 1px 2px rgba(16,24,40,.12)" : "none" }}>
              {f === "all" ? "All" : f === "active" ? "Active" : "Inactive"}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {lastSync ? `Synced ${new Date(lastSync).toLocaleString()}` : "Never synced — bấm Sync now"}
        </span>
        <span style={{ flex: 1 }} />
        <a href="/shopify-products?adskit=1&newcamp=1" style={{ border: "none", background: "#16A34A", color: "#fff", borderRadius: 10, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>＋ New campaign</a>
        <button onClick={syncNow} disabled={syncBusy} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: syncBusy ? .6 : 1 }}>
          {syncBusy ? "Syncing…" : "⟳ Sync now"}
        </button>
        <select value={aiModel} onChange={(e) => pickModel(e.target.value)} title="AI model"
          style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "7px 8px", fontSize: 12.5, background: "#fff", maxWidth: 190 }}>
          <option value="">Model: server default</option>
          {aiModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button onClick={analyze} disabled={aiBusy || !rows.length} style={{ border: "none", background: "#7C5CFF", color: "#fff", borderRadius: 10, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: aiBusy || !rows.length ? .6 : 1 }}>
          {aiBusy ? "Analyzing…" : "🤖 AI Analyze"}
        </button>
      </div>
      {err && <div style={{ ...card, padding: "10px 16px", borderColor: "#F5CFCF", background: "#FDECEC", color: "#C0392B", fontSize: 13, fontWeight: 600 }}>{err}</div>}

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {[
          ["Spend", money(totals.spend)],
          ["Link clicks", num(totals.lc)],
          ["CTR (link)", totals.imp ? (100 * totals.lc / totals.imp).toFixed(2) + "%" : "—"],
          ["Add to cart", num(totals.atc)],
          ["Cost / ATC", totals.atc ? money(totals.spend / totals.atc) : "—"],
          ["Purchases", num(totals.pur)],
          ["CPA", totals.pur ? money(totals.spend / totals.pur) : "—"],
          ["ROAS", totals.spend ? (totals.rev / totals.spend).toFixed(2) : "—"],
        ].map(([label, v]) => (
          <div key={label as string} style={{ ...card, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".3px", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* AI result */}
      {ai && (
        <div style={{ ...card, padding: 18, borderColor: "#D8CCFF", background: "#FBFAFF" }}>
          <b style={{ fontSize: 14 }}>🤖 AI Analysis</b>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: "8px 0 10px" }}>{ai.summary}</p>
          {(ai.actions ?? []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(ai.actions ?? []).map((a, i) => {
                const st = ACTION_STYLE[a.action] ?? ACTION_STYLE.watch;
                const executable = ["pause", "raise_budget", "lower_budget"].includes(a.action) && (a.adId || a.adsetId);
                return (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
                    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: st.bg, color: st.fg, marginTop: 1 }}>{st.label}</span>
                    <span style={{ flex: 1 }}><b>{a.ad}</b> — {a.reason}</span>
                    {applied[i]
                      ? <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#1F6F45" }}>✓ {applied[i]}</span>
                      : executable && (
                        <button onClick={() => applyAction(i, a)} disabled={applyBusy >= 0}
                          style={{ flexShrink: 0, border: "none", borderRadius: 8, padding: "3px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer",
                            background: armIdx === i ? "#B45309" : "#111827", color: "#fff", opacity: applyBusy >= 0 && applyBusy !== i ? .5 : 1 }}>
                          {applyBusy === i ? "…" : armIdx === i ? "Confirm?" : "Approve"}
                        </button>
                      )}
                  </div>
                );
              })}
            </div>
          )}
          {ai.nextTest && <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>💡 {ai.nextTest}</p>}
        </div>
      )}

      {/* Tables per campaign */}
      {busy && !rows.length ? <div style={{ ...card, padding: 24, textAlign: "center", color: "var(--muted)" }}>Loading…</div> : null}
      {!busy && !rows.length ? <div style={{ ...card, padding: 24, textAlign: "center", color: "var(--muted)" }}>No data yet — bấm ⟳ Sync now (cần env META_SYSTEM_TOKEN, đã chạy MIGRATION_v449).</div> : null}
      {grouped.map(([campId, g]) => {
        const ads = g.ads;
        const status = campStatus[campId] ?? "";
        const isActive = status === "ACTIVE";
        // Filter theo trạng thái; campaign không rõ status (chưa sync) chỉ hiện ở All.
        if (statusFilter === "active" && !isActive) return null;
        if (statusFilter === "inactive" && (isActive || !status)) return null;
        // Mặc định: campaign đang tắt thì thu gọn sẵn cho đỡ rối.
        const isCollapsed = collapsed[campId] ?? (status ? !isActive : false);
        const ct = ads.reduce((s, a) => ({ spend: s.spend + a.spend, imp: s.imp + a.imp, lc: s.lc + a.lc, atc: s.atc + a.atc, pur: s.pur + a.pur, rev: s.rev + a.rev }), { spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 });
        return (
          <div key={campId} style={{ ...card, padding: "6px 6px 2px", overflow: "hidden" }}>
            <div onClick={() => toggleCamp(campId, isCollapsed)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 6px", cursor: "pointer", userSelect: "none" }}>
              <span style={{ fontSize: 11, color: "var(--muted)", transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform .12s", width: 12, display: "inline-block" }}>▼</span>
              {/* v457 · bật/tắt campaign ngay tại đây (arm 2 bước) */}
              {ent && ent.camp[campId] !== undefined && (
                <Toggle on={ent.camp[campId] === "ACTIVE"} armed={ctlArm === "camp:" + campId} busy={ctlBusy === "camp:" + campId}
                  onClick={() => toggleStatus("camp", campId)} />
              )}
              {/* v533 · đổi tên campaign — sửa inline ngay tại chỗ */}
              {renEdit?.kind === "camp" && renEdit.id === campId ? (
                <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input autoFocus value={renEdit.val} onChange={(e) => setRenEdit({ kind: "camp", id: campId, val: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenEdit(null); }}
                    style={renInput(260, 13.5)} />
                  <button onClick={saveRename} disabled={renBusy === "camp:" + campId} style={renOkBtn}>{renBusy === "camp:" + campId ? "…" : "✓"}</button>
                  <button onClick={() => setRenEdit(null)} style={renXBtn}>✕</button>
                </span>
              ) : (<>
                <b style={{ fontSize: 14 }}>{g.name}</b>
                <button onClick={(e) => { e.stopPropagation(); setRenEdit({ kind: "camp", id: campId, val: g.name }); }}
                  title="Đổi tên campaign" style={penBtn}>✎</button>
              </>)}
              {status && (
                <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, letterSpacing: ".3px",
                  background: isActive ? "#E9F7EF" : "#F1F1F4", color: isActive ? "#1F6F45" : "#8794A5" }}>
                  {isActive ? "ACTIVE" : status}
                </span>
              )}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {ads.length ? `${ads.length} ads · ${money(ct.spend)} · ${ct.pur} purchases${ct.spend ? ` · ROAS ${(ct.rev / ct.spend).toFixed(2)}` : ""}` : "mới tạo — chưa có chi tiêu trong khoảng ngày này"}
              </span>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                {/* v535 · dup campaign — copy khung rồi sang kit chọn product */}
                <button onClick={() => dupCamp(campId, g.name)} disabled={dupBusy === "camp:" + campId}
                  style={{ ...rowBtn, padding: "3px 11px", fontSize: 11, opacity: dupBusy === "camp:" + campId ? 0.5 : 1 }}>
                  {dupBusy === "camp:" + campId ? "…" : "⧉ Dup camp"}
                </button>
                {/* v525 · tạo ads mới vào ĐÚNG campaign này — mở Meta Ads Kit bên Manage Products với campaign đã trỏ sẵn */}
                <a href={`/shopify-products?adskit=1&campaignId=${campId}&campaign=${encodeURIComponent(g.name)}`} style={{ ...rowBtn, textDecoration: "none", padding: "3px 11px", fontSize: 11 }}>＋ Ads</a>
              </span>
            </div>
            <div style={{ overflowX: "auto", display: isCollapsed || !ads.length ? "none" : "block" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={{ ...th, textAlign: "left" }}>Ad</th>
                  <th style={th}>Spend</th><th style={th}>Impr</th><th style={th}>Link clicks</th><th style={th}>CTR</th><th style={th}>CPC</th>
                  <th style={th}>ATC</th><th style={th}>$/ATC</th><th style={th}>Purch</th><th style={th}>CPA</th><th style={th}>Revenue</th><th style={th}>ROAS</th>
                </tr></thead>
                <tbody>
                  {ads.map((a, ai) => (<>
                    {/* v454 · hàng AD SET — hiện khi bắt đầu nhóm mới, kèm subtotal của cả set. */}
                    {(ai === 0 || ads[ai - 1].adset !== a.adset) && (() => {
                      const grp = ads.filter((x) => x.adset === a.adset);
                      const gs = grp.reduce((s2, x) => ({ spend: s2.spend + x.spend, atc: s2.atc + x.atc, pur: s2.pur + x.pur, rev: s2.rev + x.rev }), { spend: 0, atc: 0, pur: 0, rev: 0 });
                      return (
                        <tr key={"set-" + a.adset} style={{ background: "#F7F9FC", borderBottom: "1px solid #EDF0F4" }}>
                          <td colSpan={12} style={{ padding: "6px 10px", fontSize: 11, fontWeight: 800, color: "#5B6472" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                              {/* v457 · bật/tắt ad set */}
                              {ent?.adsets[a.adsetId] && (
                                <Toggle on={ent.adsets[a.adsetId].status === "ACTIVE"} armed={ctlArm === "adset:" + a.adsetId} busy={ctlBusy === "adset:" + a.adsetId}
                                  dim={ent.adsets[a.adsetId].status === "ACTIVE" && ent.adsets[a.adsetId].eff === "CAMPAIGN_PAUSED"}
                                  onClick={() => toggleStatus("adset", a.adsetId)} />
                              )}
                              {/* v533 · đổi tên ad set — sửa inline */}
                              {renEdit?.kind === "adset" && renEdit.id === a.adsetId ? (
                                <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <span>▪</span>
                                  <input autoFocus value={renEdit.val} onChange={(e) => setRenEdit({ kind: "adset", id: a.adsetId, val: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenEdit(null); }}
                                    style={renInput(220, 11.5)} />
                                  <button onClick={saveRename} disabled={renBusy === "adset:" + a.adsetId} style={renOkBtn}>{renBusy === "adset:" + a.adsetId ? "…" : "✓"}</button>
                                  <button onClick={() => setRenEdit(null)} style={renXBtn}>✕</button>
                                </span>
                              ) : (<>
                                <span>▪ {a.adset || "(no ad set)"}</span>
                                <button onClick={(e) => { e.stopPropagation(); setRenEdit({ kind: "adset", id: a.adsetId, val: a.adset }); }}
                                  title="Đổi tên ad set" style={penBtn}>✎</button>
                              </>)}
                              {/* v457 · budget/ngày — bấm ✎ để sửa, Enter hoặc ✓ để lưu */}
                              {ent?.adsets[a.adsetId] && (budEdit?.id === a.adsetId ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <span>$</span>
                                  <input autoFocus value={budEdit.val} onChange={(e) => setBudEdit({ id: a.adsetId, val: e.target.value.replace(/[^0-9.]/g, "") })}
                                    onKeyDown={(e) => { if (e.key === "Enter") saveBudget(a.adsetId); if (e.key === "Escape") setBudEdit(null); }}
                                    style={{ width: 56, border: "1px solid #C9D2DE", borderRadius: 6, padding: "2px 6px", fontSize: 11.5, font: "inherit", outline: "none" }} />
                                  <button onClick={() => saveBudget(a.adsetId)} disabled={ctlBusy === "bud:" + a.adsetId}
                                    style={{ border: "none", background: "#16A34A", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
                                    {ctlBusy === "bud:" + a.adsetId ? "…" : "✓"}
                                  </button>
                                  <button onClick={() => setBudEdit(null)} style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>✕</button>
                                </span>
                              ) : (
                                <span onClick={() => setBudEdit({ id: a.adsetId, val: String(ent.adsets[a.adsetId].budget || "") })} title="Sửa daily budget của ad set"
                                  style={{ cursor: "pointer", color: "#1D4ED8", background: "#EDF3FF", borderRadius: 999, padding: "1px 8px", fontWeight: 700 }}>
                                  {ent.adsets[a.adsetId].budget ? `$${ent.adsets[a.adsetId].budget}/day` : "CBO"} ✎
                                </span>
                              ))}
                              <span style={{ fontWeight: 600, color: "var(--muted)" }}>
                                {grp.length} ad{grp.length > 1 ? "s" : ""} · {money(gs.spend)} · {gs.atc} ATC · {gs.pur} purch{gs.spend ? ` · ROAS ${(gs.rev / gs.spend).toFixed(2)}` : ""}
                              </span>
                              {/* v525 · tạo ads thẳng vào ad set này / nhân bản cả ad set (kèm ads, PAUSED) */}
                              <a href={`/shopify-products?adskit=1&campaignId=${campId}&campaign=${encodeURIComponent(g.name)}&adsetId=${a.adsetId}&adset=${encodeURIComponent(a.adset)}`}
                                onClick={(e) => e.stopPropagation()} style={{ ...rowBtn, textDecoration: "none" }}>＋ Ads</a>
                              <button onClick={(e) => { e.stopPropagation(); dupAdset(a.adsetId, a.adset, campId); }} disabled={dupBusy === "adset:" + a.adsetId} style={{ ...rowBtn, opacity: dupBusy === "adset:" + a.adsetId ? 0.5 : 1 }}>
                                {dupBusy === "adset:" + a.adsetId ? "…" : "⧉ Dup set"}
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })()}
                    <tr key={a.ad} style={{ borderBottom: "1px solid #F1F3F6" }}>
                      <td style={{ ...td, textAlign: "left", maxWidth: 360, paddingLeft: 22 }} title={`${a.adset} › ${a.ad}`}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, maxWidth: "100%" }}>
                          {/* v457 · bật/tắt từng ad */}
                          {ent && ent.ads[a.adId] !== undefined && (() => {
                            // v463 · công tắc riêng của ad vẫn ACTIVE nhưng TẦNG CHA tắt → hiện mờ + nhãn ⏸
                            const ad = ent.ads[a.adId]!;
                            const offByParent = ad.status === "ACTIVE" && (ad.eff === "ADSET_PAUSED" || ad.eff === "CAMPAIGN_PAUSED");
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, opacity: offByParent ? 0.45 : 1 }}
                                title={offByParent ? (ad.eff === "ADSET_PAUSED" ? "Ad set đang OFF — ad này KHÔNG chạy dù công tắc riêng vẫn bật" : "Campaign đang OFF — ad này KHÔNG chạy dù công tắc riêng vẫn bật") : undefined}>
                                <Toggle on={ad.status === "ACTIVE"} armed={ctlArm === "ad:" + a.adId} busy={ctlBusy === "ad:" + a.adId}
                                  onClick={() => toggleStatus("ad", a.adId)} />
                                {offByParent && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#8A93A6", background: "#EEF1F5", borderRadius: 5, padding: "1px 5px", whiteSpace: "nowrap" }}>⏸ {ad.eff === "ADSET_PAUSED" ? "theo set" : "theo camp"}</span>}
                              </span>
                            );
                          })()}
                          {/* v462 · thumbnail creative — click phóng to để biết đang nhìn MẪU nào */}
                          {ent?.ads[a.adId]?.thumb && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={ent.ads[a.adId]!.thumb!} alt="" loading="lazy"
                              onClick={(e) => { e.stopPropagation(); setZoom(ent.ads[a.adId]?.img || ent.ads[a.adId]?.thumb || ""); }}
                              title="Xem lớn creative"
                              style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 6, cursor: "zoom-in", flexShrink: 0, border: "1px solid #E3E7EE", background: "#F4F6F9" }} />
                          )}
                          {/* v533 · đổi tên ad — sửa inline */}
                          {renEdit?.kind === "ad" && renEdit.id === a.adId ? (
                            <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <input autoFocus value={renEdit.val} onChange={(e) => setRenEdit({ kind: "ad", id: a.adId, val: e.target.value })}
                                onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenEdit(null); }}
                                style={renInput(220, 12)} />
                              <button onClick={saveRename} disabled={renBusy === "ad:" + a.adId} style={renOkBtn}>{renBusy === "ad:" + a.adId ? "…" : "✓"}</button>
                              <button onClick={() => setRenEdit(null)} style={renXBtn}>✕</button>
                            </span>
                          ) : (<>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.ad}</span>
                            <button onClick={(e) => { e.stopPropagation(); setRenEdit({ kind: "ad", id: a.adId, val: a.ad }); }}
                              title="Đổi tên ad" style={penBtn}>✎</button>
                          </>)}
                          {/* v525 · dup ad này (PAUSED) — mặc định cùng ad set, dán ID khác để thả vào winner MAIN */}
                          <button onClick={(e) => { e.stopPropagation(); dupAd(a.adId, a.ad, a.adsetId, a.adset); }} disabled={dupBusy === "ad:" + a.adId}
                            title="Duplicate ad — chọn product bên Shopify rồi push" style={{ ...rowBtn, padding: "0 7px", flexShrink: 0, opacity: dupBusy === "ad:" + a.adId ? 0.5 : 1 }}>⧉</button>
                          {/* v537 · mở đúng listing bên Manage Products · Shopify để sửa (suy từ link đích của creative) — v538 style badge SHOPIFY, mở tab mới */}
                          {(() => {
                            const l = ent?.ads[a.adId]?.plink ?? "";
                            const m = l.match(/\/products\/([^/?#]+)/);
                            return m ? (
                              <a href={`/shopify-products?edit=${encodeURIComponent(m[1])}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                title="Sửa listing bên Manage Products · Shopify (tab mới)"
                                style={{ background: "#3F9142", color: "#fff", borderRadius: 999, padding: "2px 10px", fontSize: 9.5, fontWeight: 800, letterSpacing: ".4px", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0, lineHeight: "16px" }}>
                                ⬆ SHOPIFY
                              </a>
                            ) : null;
                          })()}
                        </span>
                      </td>
                      <td style={{ ...td, fontWeight: 700 }}>{money(a.spend)}</td>
                      <td style={td}>{num(a.imp)}</td>
                      <td style={td}>{num(a.lc)}</td>
                      <td style={{ ...td, fontWeight: 700, color: a.imp && 100 * a.lc / a.imp >= 1.5 ? "#1F6F45" : a.imp ? "#B7791F" : "inherit" }}>{a.imp ? (100 * a.lc / a.imp).toFixed(2) + "%" : "—"}</td>
                      <td style={td}>{a.lc ? money(a.spend / a.lc) : "—"}</td>
                      <td style={td}>{num(a.atc)}</td>
                      <td style={td}>{a.atc ? money(a.spend / a.atc) : "—"}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{num(a.pur)}</td>
                      <td style={{ ...td, color: a.pur && a.spend / a.pur <= 25 ? "#1F6F45" : "inherit" }}>{a.pur ? money(a.spend / a.pur) : "—"}</td>
                      <td style={td}>{money(a.rev)}</td>
                      <td style={{ ...td, fontWeight: 800, color: a.spend && a.rev / a.spend >= 1.5 ? "#1F6F45" : a.spend && a.rev > 0 ? "#B7791F" : "inherit" }}>{a.spend ? (a.rev / a.spend).toFixed(2) : "—"}</td>
                    </tr>
                  </>))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {/* v534 · form Dup ad set / Dup ad trong trang — thay chuỗi hộp thoại của trình duyệt */}
      {dupForm && (
        <div onClick={() => setDupForm(null)} style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(15,20,40,.55)", overflowY: "auto", padding: "60px 16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ margin: "0 auto", maxWidth: 430, background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,20,40,.35)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <b style={{ fontSize: 14.5 }}>{dupForm.kind === "camp" ? "⧉ Duplicate campaign" : dupForm.kind === "adset" ? "⧉ Duplicate ad set" : "⧉ Duplicate ad"}</b>
            <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              {dupForm.kind === "camp"
                ? <>Tạo campaign MỚI copy cấu hình từ <b>{dupForm.label}</b> (PAUSED, chưa có ads) → chuyển sang Manage Products để <b>tick sản phẩm Shopify</b>, chọn Structure rồi Push — như luồng ＋ New campaign.</>
                : dupForm.kind === "adset"
                ? <>Copy KHUNG ad set <b>{dupForm.label}</b> (targeting + tối ưu hoá, PAUSED, chưa có ads) → chuyển sang Manage Products để <b>tick sản phẩm Shopify</b> rồi Push ads vào bản sao.</>
                : <>Tạo ad mới vào ad set đích: chuyển sang Manage Products để <b>tick sản phẩm Shopify</b>, chỉnh text/ảnh rồi Push.</>}
            </span>
            <label style={dupLbl}>Tên bản sao
              <input autoFocus value={dupForm.name} onChange={(e) => setDupForm({ ...dupForm, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") submitDup(); if (e.key === "Escape") setDupForm(null); }} style={dupInp} />
            </label>
            {dupForm.kind !== "camp" && (
              <label style={dupLbl}>{dupForm.kind === "adset" ? "Campaign ID đích — trống = giữ campaign hiện tại; dán ID campaign MAIN để thăng cấp winner" : "Ad set ID đích — mặc định = chính ad set này; dán ID ad set winner trong MAIN để thả biến thể"}
                <input value={dupForm.target} onChange={(e) => setDupForm({ ...dupForm, target: e.target.value.replace(/\D/g, "") })} style={dupInp} />
              </label>
            )}
            {dupForm.kind === "adset" && (
              <label style={dupLbl}>Daily budget $ cho bản sao — trống = giữ budget cũ
                <input value={dupForm.budget} onChange={(e) => setDupForm({ ...dupForm, budget: e.target.value.replace(/[^0-9.]/g, "") })} style={dupInp} placeholder="vd 25" />
              </label>
            )}
            {dupForm.kind === "adset" && (
              <label style={dupLbl}>Lịch chạy (giờ máy anh) — trống = theo ad set gốc (giờ gốc đã qua thì bật là chạy ngay)
                <input type="datetime-local" value={dupForm.start} onChange={(e) => setDupForm({ ...dupForm, start: e.target.value })} style={dupInp} />
              </label>
            )}
            {dupForm.kind !== "camp" && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: "#5B6472", cursor: "pointer" }}>
                <input type="checkbox" checked={dupForm.deep} onChange={(e) => setDupForm({ ...dupForm, deep: e.target.checked })} style={{ marginTop: 2 }} />
                <span>{dupForm.kind === "adset"
                  ? "Copy KÈM toàn bộ ads bên trong (giữ nguyên creative/sản phẩm — bỏ qua bước chọn product). Dùng khi thăng cấp winner sang MAIN y nguyên."
                  : "Copy y nguyên creative/sản phẩm của ad này (bỏ qua bước chọn product)."}</span>
              </label>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setDupForm(null)} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
              <button onClick={submitDup} disabled={!!dupBusy} style={{ border: "none", background: "#1D4ED8", color: "#fff", borderRadius: 10, padding: "8px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: dupBusy ? .6 : 1 }}>
                {dupBusy ? "Working…" : dupForm.kind !== "camp" && dupForm.deep ? "⧉ Duplicate" : "⧉ Dup & chọn products →"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* v462 · overlay xem lớn creative — click nền hoặc ảnh để đóng */}
      {zoom && (
        <div onClick={() => setZoom("")} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(16,20,28,.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 30, cursor: "zoom-out" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" style={{ maxWidth: "90vw", maxHeight: "88vh", objectFit: "contain", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.45)", background: "#fff" }} />
        </div>
      )}
    </div>
  );
}
