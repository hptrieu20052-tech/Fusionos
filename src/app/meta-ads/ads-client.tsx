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
      title={title ?? (dim ? "Parent level is OFF — this item does NOT deliver even though its own switch is on" : on ? "ON — click twice to turn off" : "OFF — click twice to turn on")}
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
  const [campList, setCampList] = useState<{ id: string; name: string; status: string; seller?: string | null }[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active"); // v540 · mặc định lọc Active
  // v572 · lọc theo SELLER. Seller của camp = gán tay (DB) > đoán từ tên (token đầu không phải từ khoá).
  const UNASSIGNED = "(unassigned)";
  const [sellerFilter, setSellerFilter] = useState("");
  // v574 · tab riêng cho thống kê seller — chừa không gian màn hình chính cho quản lý ads.
  const [view, setView] = useState<"ads" | "sellers">("ads");
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
  type AdEnt = { status: string; eff?: string; thumb?: string | null; img?: string | null; name?: string; adsetId?: string; campId?: string; plink?: string | null; seller?: string | null };
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

  // v570 · RULE ENGINE — verdict từng ad (WAITING/STARVED/GRACE/ALIVE/KILL/WINNER/CHECK + MAIN_*)
  // engine chấm nền 2h/lần trên LIFETIME; UI chỉ đọc bảng state + nút Undo/Rotate/Run now.
  type RuleRow = { adId: string; verdict: string; phase?: string | null; reason?: string | null; autoPaused?: boolean; pauseReason?: string | null; resumeAt?: string | null };
  const [rules, setRules] = useState<Map<string, RuleRow>>(new Map());
  const [ruleCfg, setRuleCfg] = useState<{ campKillSpend7d: number; adsetMinAlive: number; adsetMaxActive: number } | null>(null);
  const [ruleRunAt, setRuleRunAt] = useState<string | null>(null);
  const [ruleBusy, setRuleBusy] = useState("");
  const loadRules = useCallback(async () => {
    try {
      const j = await fetch("/api/meta-ads/rules").then((r) => r.json());
      if (j.ok) {
        setRules(new Map((j.state as RuleRow[]).map((r) => [r.adId, r])));
        setRuleCfg(j.config ?? null);
        setRuleRunAt(j.lastRunAt ?? null);
      }
    } catch { /* rule là phụ — lỗi không chặn bảng số */ }
  }, []);
  useEffect(() => { loadRules(); }, [loadRules]);
  const ruleAction = async (key: string, body: Record<string, unknown>) => {
    if (ruleBusy) return;
    setRuleBusy(key); setErr("");
    try {
      const j = await fetch("/api/meta-ads/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (!j.ok) setErr(j.error ?? "Rule action failed");
      await Promise.all([loadRules(), loadEnt()]);
    } catch (e) { setErr(String((e as Error).message)); }
    setRuleBusy("");
  };
  // arm 2 bước cho Rotate (tắt ad thật) — chống bấm nhầm.
  const [rotArm, setRotArm] = useState("");

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
    if (!isFinite(dollars) || dollars <= 0) { setErr("Budget must be a number > 0"); return; }
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
  // v576 · moveOff: sau khi copy xong thì TẮT ad gốc — "chuyển" ad sang ad set/camp khác trong 1 phát
  // (Meta không có move thật; chuẩn là copy giữ post rồi tắt gốc — đây là 2 bước gộp 1).
  const [dupForm, setDupForm] = useState<{ kind: "camp" | "adset" | "ad"; id: string; label: string; name: string; target: string; orig: string; budget: string; deep: boolean; adsetName: string; start: string; picks: Record<string, boolean>; moveOff?: boolean } | null>(null);
  const dupCamp = (campId: string, campName: string) =>
    setDupForm({ kind: "camp", id: campId, label: campName || campId, name: `${campName} - Copy`, target: "", orig: "", budget: "", deep: false, adsetName: "", start: "", picks: {} });
  const dupAdset = (adsetId: string, adsetName: string, campId: string) =>
    setDupForm({ kind: "adset", id: adsetId, label: adsetName || adsetId, name: `${adsetName} - Copy`, target: campId, orig: campId, budget: "", deep: false, adsetName, start: "", picks: {} });
  const dupAd = (adId: string, adName: string, curAdsetId: string, curAdsetName: string) =>
    setDupForm({ kind: "ad", id: adId, label: adName || adId, name: `${adName} - Copy`, target: curAdsetId, orig: curAdsetId, budget: "", deep: false, adsetName: curAdsetName, start: "", picks: {} });
  // v551 · ads nằm trong ad set nguồn (để chọn con nào được copy kèm)
  const adsInSet = (adsetId: string) => Object.entries(ent?.ads ?? {}).filter(([, a]) => a.adsetId === adsetId);
  const submitDup = async () => {
    if (!dupForm || dupBusy) return;
    const f = dupForm;
    if (f.kind === "ad" && !f.target.trim()) { setErr("Target ad set is required"); return; }
    setDupBusy(f.kind + ":" + f.id); setErr("");
    // v539 · kit mở ở TAB MỚI (giữ nguyên màn Ads Center đang làm việc). Mở tab trống NGAY trong cú
    // click (trước await) để không bị popup blocker chặn, xong mới trỏ URL; lỗi thì đóng tab lại.
    const willRedirect = f.kind === "camp" || !f.deep;
    let tab: Window | null = null;
    if (willRedirect) { try { tab = window.open("about:blank", "_blank"); } catch { tab = null; } }
    const goto = (url: string) => { if (tab) tab.location.href = url; else window.open(url, "_blank"); };
    // v546 · gom handle SẢN PHẨM của các ads bên trong (từ link creative) → bên kia tự tick sẵn + tự mở kit,
    // KHÔNG phải search/chọn lại. Dùng cho cả 3 tầng: ad (1 sp) / ad set / campaign (nhiều sp).
    const handlesIn = (pick: (ad: { adsetId?: string; campId?: string; plink?: string | null }) => boolean): string => {
      const hs = new Set<string>();
      for (const ad of Object.values(ent?.ads ?? {})) {
        if (!pick(ad)) continue;
        const m = (ad.plink ?? "").match(/\/products\/([^/?#]+)/);
        if (m) hs.add(m[1]);
      }
      return Array.from(hs).slice(0, 30).join(",");
    };
    try {
      if (f.kind === "camp") {
        // Copy khung campaign → sang kit chọn product (push sẽ tạo ad set + ads vào campaign mới).
        const j = await fetch("/api/meta-ads/duplicate", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "campaign", id: f.id, name: f.name.trim() }) }).then((r) => r.json());
        if (j.ok && j.id) {
          const hs = handlesIn((ad) => ad.campId === f.id);
          goto(`/shopify-products?adskit=1&campaignId=${j.id}&campaign=${encodeURIComponent(f.name.trim())}${hs ? `&sel=${encodeURIComponent(hs)}` : ""}`);
          setErr(hs ? `✓ New campaign #${j.id} — kit opened in a NEW TAB with the source campaign's products pre-selected.` : `✓ New campaign #${j.id} — product-picker kit opened in a NEW TAB.`);
          setDupForm(null); loadEnt();
        } else { try { tab?.close(); } catch { /* ignore */ } setErr(j.ok ? "⚠ " + (j.warn ?? "Copied — check Ads Manager.") : "✗ " + (j.error ?? "Dup failed")); }
      } else if (f.kind === "adset") {
        // v551 · nếu người dùng bỏ tick bớt ads trong danh sách → chỉ copy những ad đã chọn.
        // v555 · Meta deep_copy đồng bộ giới hạn <3 ads → LUÔN đi đường copy khung + copy TỪNG ad
        // (adIds) khi biết danh sách ads; deep_copy chỉ còn là fallback khi entities chưa tải được.
        const inSet = adsInSet(f.id).map(([id]) => id);
        const chosen = inSet.filter((id) => f.picks[id] !== false);
        if (f.deep && inSet.length && !chosen.length) { setErr("Select at least 1 ad to copy"); setDupBusy(""); return; }
        const j = await fetch("/api/meta-ads/duplicate", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "adset", id: f.id, campaignId: f.target.trim(), name: f.name.trim(), budget: Number(f.budget) || undefined, deep: f.deep,
            ...(f.deep && inSet.length ? { adIds: chosen } : {}),
            startTime: f.start ? new Date(f.start).toISOString() : undefined }) }).then((r) => r.json());
        if (!j.ok) { try { tab?.close(); } catch { /* ignore */ } setErr("✗ " + (j.error ?? "Dup failed")); }
        else if (j.warn) { try { tab?.close(); } catch { /* ignore */ } setErr(`⚠ ${j.warn}${j.id && !f.deep ? ` New ad set #${j.id} was created — after Sync, use ＋ Ads on it to add ads.` : ""}`); setDupForm(null); loadEnt(); }
        else if (f.deep) { setErr(`✓ Ad set duplicated${j.id ? ` (#${j.id})` : ""} WITH ${inSet.length ? `${chosen.length}/${inSet.length} selected` : "its"} ads — PAUSED${f.start ? `, scheduled for ${new Date(f.start).toLocaleString()}` : ""}. Hit ⟳ Sync now to see it; enable after review.`); setDupForm(null); loadEnt(); }
        else if (j.id) {
          const hs = handlesIn((ad) => ad.adsetId === f.id);
          goto(`/shopify-products?adskit=1&adsetId=${j.id}&adset=${encodeURIComponent(f.name.trim())}${hs ? `&sel=${encodeURIComponent(hs)}` : ""}`);
          setErr(hs ? `✓ New ad set #${j.id} — kit opened in a NEW TAB with the source ad set's products pre-selected.` : `✓ New ad set #${j.id} — product-picker kit opened in a NEW TAB.`);
          setDupForm(null); loadEnt();
        } else { try { tab?.close(); } catch { /* ignore */ } setErr("⚠ Copied — check Ads Manager."); }
      } else {
        // kind === "ad"
        if (f.deep) {
          const j = await fetch("/api/meta-ads/duplicate", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "ad", id: f.id, adsetId: f.target.trim(), name: f.name.trim() }) }).then((r) => r.json());
          if (j.ok) {
            // v576 · "move": copy xong tự TẮT ad gốc — lỗi tắt không phá copy, chỉ nhắc tắt tay.
            let offNote = "";
            if (f.moveOff) {
              try {
                const p = await fetch("/api/meta-ads/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_status", id: f.id, status: "PAUSED" }) }).then((r) => r.json());
                offNote = p.ok ? " Original ad turned OFF." : " ⚠ Could not turn off the original — do it manually.";
              } catch { offNote = " ⚠ Could not turn off the original — do it manually."; }
            }
            setErr(`✓ Ad duplicated${j.id ? ` (#${j.id})` : ""} — PAUSED (turn it on after review).${offNote} Hit ⟳ Sync now to see it.`);
            setDupForm(null); loadEnt();
          }
          else setErr("✗ " + (j.error ?? "Dup failed"));
        } else {
          // Không cần gọi Meta — sang thẳng kit ở tab mới, push ad mới vào ad set đích.
          // v544 · kèm handle sản phẩm của ad này (suy từ link creative) → bên kia TỰ TICK SẴN + tự mở kit.
          const nm = f.target.trim() === f.orig ? f.adsetName : ""; // tên chỉ đúng khi đích = ad set gốc
          const ph = ((ent?.ads[f.id]?.plink ?? "").match(/\/products\/([^/?#]+)/) ?? [])[1] ?? "";
          goto(`/shopify-products?adskit=1&adsetId=${f.target.trim()}${nm ? `&adset=${encodeURIComponent(nm)}` : ""}${ph ? `&sel=${encodeURIComponent(ph)}` : ""}`);
          setErr(ph ? "✓ Kit opened in a NEW TAB — this ad's product is pre-selected; review image/text then Push." : "✓ Product-picker kit opened in a NEW TAB — select products then Push into the target ad set.");
          setDupForm(null);
        }
      }
    } catch (e) { try { tab?.close(); } catch { /* ignore */ } setErr("✗ " + String((e as Error).message)); }
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
    if (!name) { setErr("Name cannot be empty"); return; }
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
  // v547 · tick nhiều ads (khác ad set cũng được) → tạo campaign MỚI từ đúng các sản phẩm đó.
  const [adSel, setAdSel] = useState<Set<string>>(new Set());
  const toggleAdSel = (id: string) => setAdSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const newCampFromSel = () => {
    const hs = new Set<string>();
    adSel.forEach((id) => {
      const m = (ent?.ads[id]?.plink ?? "").match(/\/products\/([^/?#]+)/);
      if (m) hs.add(m[1]);
    });
    if (!hs.size) { setErr("✗ The selected ads have no product link in their creatives — cannot resolve products."); return; }
    window.open(`/shopify-products?adskit=1&newcamp=1&sel=${encodeURIComponent(Array.from(hs).slice(0, 30).join(","))}`, "_blank");
    setErr(`✓ Kit opened in a NEW TAB with ${hs.size} product(s) pre-selected — name the campaign, pick a Structure, then Push.`);
    setAdSel(new Set());
  };
  const renOkBtn: React.CSSProperties = { border: "none", background: "#16A34A", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer" };
  const renXBtn: React.CSSProperties = { border: "none", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" };
  const renInput = (width: number, fontSize: number): React.CSSProperties => ({ width, border: "1px solid #C9D2DE", borderRadius: 8, padding: "3px 8px", fontSize, fontWeight: 700, font: "inherit", outline: "none", background: "#fff" });
  const dupLbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#5B6472" };
  const dupInp: React.CSSProperties = { border: "1px solid #C9D2DE", borderRadius: 8, padding: "7px 10px", fontSize: 13, font: "inherit", outline: "none" };
  const rowBtn: React.CSSProperties = { border: "1px solid #C9D2DE", background: "#fff", color: "#1D4ED8", borderRadius: 999, padding: "1px 9px", fontSize: 10.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" };
  // v545 · nút DUP có style riêng (tím) + label chữ rõ ràng — phân biệt hẳn với ＋ Ads (xanh).
  const dupBtn: React.CSSProperties = { border: "1px solid #DDD3F8", background: "#F7F4FE", color: "#6D28D9", borderRadius: 999, padding: "1px 9px", fontSize: 10.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" };
  const penBtn: React.CSSProperties = { border: "none", background: "transparent", color: "#8794A5", fontSize: 12, cursor: "pointer", padding: "0 3px", flexShrink: 0, lineHeight: 1 };

  // v570 · Badge verdict theo rule engine — pill CHỮ (không emoji), màu phân biệt nhanh.
  const V_PILL: Record<string, { bg: string; fg: string }> = {
    WAITING:    { bg: "#EEF1F5", fg: "#5B6472" },
    STARVED:    { bg: "#FEF3C7", fg: "#92400E" },
    GRACE:      { bg: "#FEF3C7", fg: "#92400E" },
    ALIVE:      { bg: "#DCFCE7", fg: "#166534" },
    KILL:       { bg: "#DC2626", fg: "#FFFFFF" },
    WINNER:     { bg: "#16A34A", fg: "#FFFFFF" },
    CHECK:      { bg: "#D97706", fg: "#FFFFFF" },
    MAIN_WATCH: { bg: "#FEF3C7", fg: "#92400E" },
    MAIN_RED:   { bg: "#DC2626", fg: "#FFFFFF" },
    SCALE_FAST: { bg: "#FEF3C7", fg: "#92400E" },
    ROTATED:    { bg: "#E0E7FF", fg: "#3730A3" },
  };
  const V_LABEL: Record<string, string> = { MAIN_WATCH: "WATCH ROAS", MAIN_RED: "ROAS LOW", SCALE_FAST: "SCALING FAST", CHECK: "CHECK LANDING" };
  const ruleOf = (adId: string): RuleRow | null => rules.get(adId) ?? null;
  // Nền dòng: KILL/MAIN_RED đỏ nhạt · GRACE/STARVED/CHECK/MAIN_WATCH vàng nhạt — liếc 1 giây là thấy.
  const rowBg = (adId: string): string | undefined => {
    const v = ruleOf(adId)?.verdict ?? "";
    if (v === "KILL" || v === "MAIN_RED") return "#FEF2F2";
    if (v === "GRACE" || v === "STARVED" || v === "CHECK" || v === "MAIN_WATCH") return "#FFFBEB";
    return undefined;
  };

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

  // ---- v573 · SELLER THEO LISTING SHOPIFY (không theo tên camp) ----
  // Mỗi ad thuộc về CHỦ LISTING mà creative trỏ tới (shopify_products.created_by — v567).
  // Route /entities trả sẵn ads[].seller; ad không match được listing → (unassigned).
  const adSeller = (adId: string) => (ent?.ads[adId]?.seller ?? "").trim();
  const sellerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of Object.values(ent?.ads ?? {})) { const n = (a.seller ?? "").trim(); if (n) s.add(n); }
    return Array.from(s).sort();
  }, [ent]);
  // Thống kê theo seller (khoảng ngày đang xem) — khối riêng trên đầu trang, cộng theo TỪNG AD.
  const sellerStats = useMemo(() => {
    type S = { seller: string; camps: Set<string>; ads: Set<string>; spend: number; imp: number; lc: number; atc: number; pur: number; rev: number };
    const m = new Map<string, S>();
    for (const r of rows) {
      const key = adSeller(r.adId) || UNASSIGNED;
      const x = m.get(key) ?? { seller: key, camps: new Set<string>(), ads: new Set<string>(), spend: 0, imp: 0, lc: 0, atc: 0, pur: 0, rev: 0 };
      x.camps.add(r.campaignId); x.ads.add(r.adId);
      x.spend += Number(r.spend) || 0; x.imp += r.impressions ?? 0; x.lc += r.linkClicks ?? 0;
      x.atc += r.atc ?? 0; x.pur += r.purchases ?? 0; x.rev += Number(r.revenue) || 0;
      m.set(key, x);
    }
    return Array.from(m.values()).sort((a, b) => b.spend - a.spend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ent]);

  const th: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 10.5, fontWeight: 800, letterSpacing: ".3px", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 12.5, whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <b style={{ fontSize: 17 }}>📣 Meta Ads Center</b>
        {/* v574 · tab Ads / By seller — thống kê seller tách trang riêng */}
        <div style={{ display: "flex", gap: 4, background: "#F1F3F6", borderRadius: 10, padding: 3 }}>
          {([["ads", "Ads"], ["sellers", "By seller"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              style={{ border: "none", borderRadius: 8, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: view === k ? "#fff" : "transparent", color: view === k ? "var(--ink)" : "var(--muted)",
                boxShadow: view === k ? "0 1px 2px rgba(16,24,40,.12)" : "none" }}>
              {label}
            </button>
          ))}
        </div>
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
        {/* v572 · lọc theo seller (nguồn: gán tay + đoán từ tên camp) */}
        <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} title="Filter campaigns by seller"
          style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "6px 8px", fontSize: 12, fontWeight: 700, background: sellerFilter ? "#EDF3FF" : "#fff", maxWidth: 170 }}>
          <option value="">All sellers</option>
          {sellerOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value={UNASSIGNED}>(unassigned)</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {lastSync ? `Synced ${new Date(lastSync).toLocaleString()}` : "Never synced — hit Sync now"}
        </span>
        <span style={{ flex: 1 }} />
        <a href="/shopify-products?adskit=1&newcamp=1" target="_blank" rel="noopener noreferrer" style={{ border: "none", background: "#16A34A", color: "#fff", borderRadius: 10, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>＋ New campaign</a>
        <button onClick={syncNow} disabled={syncBusy} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: syncBusy ? .6 : 1 }}>
          {syncBusy ? "Syncing…" : "⟳ Sync now"}
        </button>
        {/* v570 · chạy rule engine ngay (bình thường tự chạy nền 2h/lần trong cron) */}
        <button onClick={() => ruleAction("run", { action: "run" })} disabled={ruleBusy === "run"}
          title={`Re-score every ad now (engine auto-runs every ~2h in the background)${ruleRunAt ? ` — last run ${new Date(ruleRunAt).toLocaleString()}` : ""}`}
          style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: ruleBusy === "run" ? .6 : 1 }}>
          {ruleBusy === "run" ? "Scoring…" : "Run rules"}
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

      {/* v574 · TAB "BY SELLER" — trang thống kê riêng (khoảng ngày đang xem).
          Bấm 1 dòng = nhảy về tab Ads đã lọc sẵn theo seller đó. */}
      {view === "sellers" && (
        <div style={{ ...card, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>Spend by seller</b>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>per-ad, by the OWNER of the Shopify listing each creative links to · click a row to open that seller&#39;s ads</span>
            {sellerFilter && (
              <button onClick={() => setSellerFilter("")} style={{ marginLeft: "auto", border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Clear filter ✕</button>
            )}
          </div>
          {!sellerStats.length && <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No spend in this date range yet.</div>}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--line)" }}>
                <th style={{ ...th, textAlign: "left" }}>Seller</th>
                <th style={th}>Camps</th><th style={th}>Ads</th><th style={th}>Spend</th><th style={th}>% Spend</th>
                <th style={th}>CTR</th><th style={th}>ATC</th><th style={th}>$/ATC</th><th style={th}>Purch</th><th style={th}>CPA</th><th style={th}>Revenue</th><th style={th}>ROAS</th>
              </tr></thead>
              <tbody>
                {sellerStats.map((s) => {
                  const key = s.seller;
                  const on = sellerFilter === key;
                  const roas = s.spend ? s.rev / s.spend : 0;
                  return (
                    <tr key={key} onClick={() => { setSellerFilter(on ? "" : key); setView("ads"); }}
                      title="Open this seller's ads"
                      style={{ borderBottom: "1px solid #F1F3F6", cursor: "pointer", background: on ? "#EDF3FF" : undefined }}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>
                        {key === UNASSIGNED ? <span style={{ color: "var(--muted)", fontWeight: 600 }}>(unassigned)</span> : key}
                      </td>
                      <td style={td}>{s.camps.size}</td>
                      <td style={td}>{s.ads.size}</td>
                      <td style={{ ...td, fontWeight: 800 }}>{money(s.spend)}</td>
                      <td style={td}>{totals.spend ? (100 * s.spend / totals.spend).toFixed(0) + "%" : "—"}</td>
                      <td style={{ ...td, color: s.imp && 100 * s.lc / s.imp >= 1.5 ? "#1F6F45" : "inherit" }}>{s.imp ? (100 * s.lc / s.imp).toFixed(2) + "%" : "—"}</td>
                      <td style={td}>{num(s.atc)}</td>
                      <td style={td}>{s.atc ? money(s.spend / s.atc) : "—"}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{num(s.pur)}</td>
                      <td style={{ ...td, color: s.pur && s.spend / s.pur <= 25 ? "#1F6F45" : "inherit" }}>{s.pur ? money(s.spend / s.pur) : "—"}</td>
                      <td style={td}>{money(s.rev)}</td>
                      <td style={{ ...td, fontWeight: 800, color: s.spend && roas >= 1.5 ? "#1F6F45" : s.spend && s.rev > 0 ? "#B7791F" : "inherit" }}>{s.spend ? roas.toFixed(2) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI result */}
      {view === "ads" && ai && (
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

      {/* Tables per campaign — chỉ ở tab Ads (v574) */}
      {view === "ads" && busy && !rows.length ? <div style={{ ...card, padding: 24, textAlign: "center", color: "var(--muted)" }}>Loading…</div> : null}
      {view === "ads" && !busy && !rows.length ? <div style={{ ...card, padding: 24, textAlign: "center", color: "var(--muted)" }}>No data yet — hit ⟳ Sync now (requires META_SYSTEM_TOKEN env + MIGRATION_v449).</div> : null}
      {view === "ads" && grouped.map(([campId, g]) => {
        // v573 · lọc theo seller Ở CẤP AD (theo chủ listing): campaign chung nhiều seller thì chỉ hiện
        // phần ads của seller đang lọc — subtotal campaign/ad set cũng chỉ cộng phần đó.
        const ads = sellerFilter
          ? g.ads.filter((a) => { const sn = adSeller(a.adId); return sellerFilter === UNASSIGNED ? !sn : sn === sellerFilter; })
          : g.ads;
        const status = campStatus[campId] ?? "";
        const isActive = status === "ACTIVE";
        // Filter theo trạng thái; campaign không rõ status (chưa sync) chỉ hiện ở All.
        if (statusFilter === "active" && !isActive) return null;
        if (statusFilter === "inactive" && (isActive || !status)) return null;
        if (sellerFilter && !ads.length) return null; // campaign không có ad nào của seller này
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
                  title="Rename campaign" style={penBtn}>✎</button>
              </>)}
              {status && (
                <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, letterSpacing: ".3px",
                  background: isActive ? "#E9F7EF" : "#F1F1F4", color: isActive ? "#1F6F45" : "#8794A5" }}>
                  {isActive ? "ACTIVE" : status}
                </span>
              )}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {ads.length ? `${ads.length} ads · ${money(ct.spend)} · ${ct.pur} purchases${ct.spend ? ` · ROAS ${(ct.rev / ct.spend).toFixed(2)}` : ""}` : "newly created — no spend in this date range yet"}
              </span>
              {/* v570 · camp TEST đốt ≥$60 (khoảng ngày đang xem) vào ads KILL mà 0 winner → đổi angle */}
              {(() => {
                if (!/test/i.test(g.name) || !ruleCfg) return null;
                const killSpend = ads.filter((x) => rules.get(x.adId)?.verdict === "KILL").reduce((s2, x) => s2 + x.spend, 0);
                const hasWinner = ads.some((x) => rules.get(x.adId)?.verdict === "WINNER");
                return killSpend >= ruleCfg.campKillSpend7d && !hasWinner ? (
                  <span title={`${money(killSpend)} burned on KILL-verdict ads in this date range with no winner — change the ANGLE, don't add more designs on the same theme`}
                    style={{ background: "#DC2626", color: "#fff", borderRadius: 6, padding: "2px 9px", fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", whiteSpace: "nowrap" }}>
                    {money(killSpend)} BURNED · CHANGE ANGLE
                  </span>
                ) : null;
              })()}
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                {/* v535 · dup campaign — copy khung rồi sang kit chọn product */}
                <button onClick={() => dupCamp(campId, g.name)} disabled={dupBusy === "camp:" + campId}
                  title="Duplicate this CAMPAIGN: copies its settings (no ads, PAUSED) → kit opens in a new tab with the source campaign's products pre-selected; adjust, then Push."
                  style={{ ...dupBtn, padding: "3px 11px", fontSize: 11, opacity: dupBusy === "camp:" + campId ? 0.5 : 1 }}>
                  {dupBusy === "camp:" + campId ? "…" : "⧉ Dup campaign"}
                </button>
                {/* v525 · tạo ads mới vào ĐÚNG campaign này — mở Meta Ads Kit bên Manage Products với campaign đã trỏ sẵn (v539 tab mới) */}
                <a href={`/shopify-products?adskit=1&campaignId=${campId}&campaign=${encodeURIComponent(g.name)}`} target="_blank" rel="noopener noreferrer" style={{ ...rowBtn, textDecoration: "none", padding: "3px 11px", fontSize: 11 }}>＋ Ads</a>
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
                              {/* v547 · tick cả AD SET — chọn/bỏ toàn bộ ads bên trong */}
                              <input type="checkbox" checked={grp.every((x) => adSel.has(x.adId))}
                                onChange={() => setAdSel((s) => { const n = new Set(s); const all = grp.every((x) => n.has(x.adId)); grp.forEach((x) => { if (all) n.delete(x.adId); else n.add(x.adId); }); return n; })}
                                onClick={(e) => e.stopPropagation()} title="Select the whole ad set — every ad inside, for the new campaign"
                                style={{ cursor: "pointer", flexShrink: 0, width: 14, height: 14, accentColor: "#16A34A" }} />
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
                                  title="Rename ad set" style={penBtn}>✎</button>
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
                                <span onClick={() => setBudEdit({ id: a.adsetId, val: String(ent.adsets[a.adsetId].budget || "") })} title="Edit ad set daily budget"
                                  style={{ cursor: "pointer", color: "#1D4ED8", background: "#EDF3FF", borderRadius: 999, padding: "1px 8px", fontWeight: 700 }}>
                                  {ent.adsets[a.adsetId].budget ? `$${ent.adsets[a.adsetId].budget}/day` : "CBO"} ✎
                                </span>
                              ))}
                              <span style={{ fontWeight: 600, color: "var(--muted)" }}>
                                {grp.length} ad{grp.length > 1 ? "s" : ""} · {money(gs.spend)} · {gs.atc} ATC · {gs.pur} purch{gs.spend ? ` · ROAS ${(gs.rev / gs.spend).toFixed(2)}` : ""}
                              </span>
                              {/* v570 · cảnh báo cấp AD SET theo rule engine (chỉ camp TEST) + SCALE_FAST (MAIN) */}
                              {(() => {
                                const chips: { t: string; tip: string; red?: boolean }[] = [];
                                const sf = rules.get("adset:" + a.adsetId);
                                if (sf?.verdict === "SCALE_FAST") chips.push({ t: "SCALING FAST", tip: sf.reason ?? "", red: false });
                                if (/test/i.test(g.name) && ruleCfg) {
                                  const alive = grp.filter((x) => { const v = rules.get(x.adId)?.verdict; return v === "ALIVE" || v === "WINNER"; }).length;
                                  const active = grp.filter((x) => ent?.ads[x.adId]?.eff === "ACTIVE").length;
                                  if (active > ruleCfg.adsetMaxActive) chips.push({ t: `${active} ADS — TOO MANY`, tip: `More than ${ruleCfg.adsetMaxActive} active ads for this budget — designs will starve each other` });
                                  else if (active && alive < ruleCfg.adsetMinAlive) chips.push({ t: `${alive}/${ruleCfg.adsetMinAlive} ALIVE — ADD DESIGNS`, tip: `Fewer than ${ruleCfg.adsetMinAlive} ALIVE ads — fill the empty slots with new designs` });
                                }
                                return chips.map((c) => (
                                  <span key={c.t} title={c.tip}
                                    style={{ background: c.red ? "#DC2626" : "#FEF3C7", color: c.red ? "#fff" : "#92400E", borderRadius: 6, padding: "1px 8px", fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", whiteSpace: "nowrap" }}>
                                    {c.t}
                                  </span>
                                ));
                              })()}
                              {/* v525 · tạo ads thẳng vào ad set này / nhân bản cả ad set (kèm ads, PAUSED) */}
                              <a href={`/shopify-products?adskit=1&campaignId=${campId}&campaign=${encodeURIComponent(g.name)}&adsetId=${a.adsetId}&adset=${encodeURIComponent(a.adset)}`}
                                target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ ...rowBtn, textDecoration: "none" }}>＋ Ads</a>
                              <button onClick={(e) => { e.stopPropagation(); dupAdset(a.adsetId, a.adset, campId); }} disabled={dupBusy === "adset:" + a.adsetId}
                                title="Duplicate this AD SET: keeps targeting + budget (PAUSED, no ads) → kit opens in a new tab with the source ad set's products pre-selected; adjust, then Push into the copy. Options: copy WITH its ads as-is / change target campaign (promote to MAIN)."
                                style={{ ...dupBtn, opacity: dupBusy === "adset:" + a.adsetId ? 0.5 : 1 }}>
                                {dupBusy === "adset:" + a.adsetId ? "…" : "⧉ Dup ad set"}
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })()}
                    <tr key={a.ad} style={{ borderBottom: "1px solid #F1F3F6", background: rowBg(a.adId) }}>
                      <td style={{ ...td, textAlign: "left", maxWidth: 360, paddingLeft: 22 }} title={`${a.adset} › ${a.ad}`}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, maxWidth: "100%" }}>
                          {/* v547 · tick ad để gom vào campaign mới (thanh nổi dưới màn hình) */}
                          <input type="checkbox" checked={adSel.has(a.adId)} onChange={() => toggleAdSel(a.adId)} onClick={(e) => e.stopPropagation()}
                            title="Select to group into a NEW campaign (multiple ads, across ad sets)"
                            style={{ cursor: "pointer", flexShrink: 0, width: 14, height: 14, accentColor: "#16A34A" }} />
                          {/* v457 · bật/tắt từng ad */}
                          {ent && ent.ads[a.adId] !== undefined && (() => {
                            // v463 · công tắc riêng của ad vẫn ACTIVE nhưng TẦNG CHA tắt → hiện mờ + nhãn ⏸
                            const ad = ent.ads[a.adId]!;
                            const offByParent = ad.status === "ACTIVE" && (ad.eff === "ADSET_PAUSED" || ad.eff === "CAMPAIGN_PAUSED");
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, opacity: offByParent ? 0.45 : 1 }}
                                title={offByParent ? (ad.eff === "ADSET_PAUSED" ? "Ad set is OFF — this ad is NOT delivering even though its own switch is on" : "Campaign is OFF — this ad is NOT delivering even though its own switch is on") : undefined}>
                                <Toggle on={ad.status === "ACTIVE"} armed={ctlArm === "ad:" + a.adId} busy={ctlBusy === "ad:" + a.adId}
                                  onClick={() => toggleStatus("ad", a.adId)} />
                                {offByParent && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#8A93A6", background: "#EEF1F5", borderRadius: 5, padding: "1px 5px", whiteSpace: "nowrap" }}>⏸ {ad.eff === "ADSET_PAUSED" ? "set off" : "camp off"}</span>}
                              </span>
                            );
                          })()}
                          {/* v462 · thumbnail creative — click phóng to để biết đang nhìn MẪU nào */}
                          {ent?.ads[a.adId]?.thumb && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={ent.ads[a.adId]!.thumb!} alt="" loading="lazy"
                              onClick={(e) => { e.stopPropagation(); setZoom(ent.ads[a.adId]?.img || ent.ads[a.adId]?.thumb || ""); }}
                              title="View creative full size"
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
                              title="Rename ad" style={penBtn}>✎</button>
                          </>)}
                          {/* v525 · dup ad này (PAUSED) — mặc định cùng ad set, dán ID khác để thả vào winner MAIN */}
                          <button onClick={(e) => { e.stopPropagation(); dupAd(a.adId, a.ad, a.adsetId, a.adset); }} disabled={dupBusy === "ad:" + a.adId}
                            title="Duplicate this AD: opens the kit with this ad's exact product pre-selected → push a new ad into the target ad set (defaults to this one; pick your MAIN Winners ad set to promote). The form also offers an exact-creative copy."
                            style={{ ...dupBtn, flexShrink: 0, opacity: dupBusy === "ad:" + a.adId ? 0.5 : 1 }}>
                            {dupBusy === "ad:" + a.adId ? "…" : "⧉ Dup ad"}
                          </button>
                          {/* v537 · mở đúng listing bên Manage Products · Shopify để sửa (suy từ link đích của creative) — v538 style badge SHOPIFY, mở tab mới */}
                          {(() => {
                            const l = ent?.ads[a.adId]?.plink ?? "";
                            const m = l.match(/\/products\/([^/?#]+)/);
                            return m ? (
                              <a href={`/shopify-products?edit=${encodeURIComponent(m[1])}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                title="Edit listing in Manage Products · Shopify (new tab)"
                                style={{ background: "#3F9142", color: "#fff", borderRadius: 999, padding: "2px 10px", fontSize: 9.5, fontWeight: 800, letterSpacing: ".4px", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0, lineHeight: "16px" }}>
                                ⬆ SHOPIFY
                              </a>
                            ) : null;
                          })()}
                          {/* v570 · badge verdict rule engine — pill chữ, tooltip = lý do đầy đủ */}
                          {(() => {
                            const r = ruleOf(a.adId);
                            if (!r) return null;
                            const st = V_PILL[r.verdict] ?? { bg: "#EEF1F5", fg: "#5B6472" };
                            const autoOff = !!r.autoPaused && ent?.ads[a.adId]?.status === "PAUSED" && r.pauseReason === "verdict";
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                <span title={r.reason ?? ""}
                                  style={{ background: st.bg, color: st.fg, borderRadius: 6, padding: "2px 8px", fontSize: 9.5, fontWeight: 800, letterSpacing: ".4px", whiteSpace: "nowrap", lineHeight: "16px", cursor: "default" }}>
                                  {V_LABEL[r.verdict] ?? r.verdict}
                                </span>
                                {autoOff && (
                                  <span title={r.reason ?? ""} style={{ background: "#111827", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 9.5, fontWeight: 800, whiteSpace: "nowrap", lineHeight: "16px" }}>AUTO-PAUSED</span>
                                )}
                                {autoOff && (
                                  <button onClick={() => ruleAction("undo:" + a.adId, { action: "undo", adId: a.adId })} disabled={ruleBusy === "undo:" + a.adId}
                                    title="Turn this ad back ON (the engine will never auto-pause it again)"
                                    style={{ border: "1px solid #C9D2DE", background: "#fff", color: "#1F2937", borderRadius: 6, padding: "1px 8px", fontSize: 9.5, fontWeight: 800, cursor: "pointer" }}>
                                    {ruleBusy === "undo:" + a.adId ? "…" : "UNDO"}
                                  </button>
                                )}
                                {r.verdict === "STARVED" && (() => {
                                  // Rotate = tạm tắt ad TOP-SPEND cùng ad set 48h để nhường impressions — arm 2 bước.
                                  const sib = ads.filter((x) => x.adsetId === a.adsetId && x.adId !== a.adId && ent?.ads[x.adId]?.eff === "ACTIVE").sort((x, y) => y.spend - x.spend)[0];
                                  if (!sib) return null;
                                  const k = "rot:" + a.adId;
                                  return (
                                    <button disabled={ruleBusy === k}
                                      onClick={() => { if (rotArm !== k) { setRotArm(k); setTimeout(() => setRotArm((c) => (c === k ? "" : c)), 4000); return; } setRotArm(""); ruleAction(k, { action: "rotate", adId: sib.adId, adName: sib.ad }); }}
                                      title={`Pause top-spend sibling "${sib.ad}" (${money(sib.spend)}) for 48h so this ad gets impressions — it turns back ON automatically`}
                                      style={{ border: "1px solid #F0C36D", background: rotArm === k ? "#B45309" : "#FFF7E6", color: rotArm === k ? "#fff" : "#92400E", borderRadius: 6, padding: "1px 8px", fontSize: 9.5, fontWeight: 800, cursor: "pointer" }}>
                                      {ruleBusy === k ? "…" : rotArm === k ? "SURE?" : "ROTATE"}
                                    </button>
                                  );
                                })()}
                              </span>
                            );
                          })()}
                        </span>
                      </td>
                      {(() => { const v = ruleOf(a.adId)?.verdict ?? ""; const red = v === "KILL" || v === "MAIN_RED"; return (
                      <td style={{ ...td, fontWeight: red ? 800 : 700, color: red ? "#DC2626" : "inherit" }}>{money(a.spend)}</td>
                      ); })()}
                      <td style={td}>{num(a.imp)}</td>
                      <td style={td}>{num(a.lc)}</td>
                      <td style={{ ...td, fontWeight: 700, color: a.imp && 100 * a.lc / a.imp >= 1.5 ? "#1F6F45" : a.imp ? "#B7791F" : "inherit" }}>{a.imp ? (100 * a.lc / a.imp).toFixed(2) + "%" : "—"}</td>
                      <td style={td}>{a.lc ? money(a.spend / a.lc) : "—"}</td>
                      {(() => { const r = ruleOf(a.adId); const red = r?.verdict === "KILL" && r?.phase === "P1" && !a.atc; return (
                      <td style={{ ...td, ...(red ? { color: "#DC2626", fontWeight: 800 } : {}) }}>{num(a.atc)}</td>
                      ); })()}
                      <td style={td}>{a.atc ? money(a.spend / a.atc) : "—"}</td>
                      {(() => { const r = ruleOf(a.adId); const red = r?.verdict === "KILL" && r?.phase === "P2" && !a.pur; return (
                      <td style={{ ...td, fontWeight: 700, ...(red ? { color: "#DC2626", fontWeight: 800 } : {}) }}>{num(a.pur)}</td>
                      ); })()}
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
      {/* v547 · thanh nổi khi có ads được tick — tạo campaign mới từ đúng các sản phẩm đó */}
      {adSel.size > 0 && (
        <div style={{ position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 260, background: "#0F172A", color: "#fff", borderRadius: 999, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 12px 40px rgba(15,23,42,.4)", whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{adSel.size} ads selected</span>
          <button onClick={newCampFromSel} style={{ border: "none", background: "#16A34A", color: "#fff", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
            ＋ New campaign from these ads
          </button>
          <button onClick={() => setAdSel(new Set())} style={{ border: "none", background: "transparent", color: "#94A3B8", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>✕ Clear</button>
        </div>
      )}
      {/* v534 · form Dup ad set / Dup ad trong trang — thay chuỗi hộp thoại của trình duyệt */}
      {dupForm && (
        <div onClick={() => setDupForm(null)} style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(15,20,40,.55)", overflowY: "auto", padding: "60px 16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ margin: "0 auto", maxWidth: 430, background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,20,40,.35)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <b style={{ fontSize: 14.5 }}>
              {dupForm.kind === "camp" ? "⧉ Duplicate campaign" : dupForm.kind === "adset" ? "⧉ Duplicate ad set" : "⧉ Duplicate ad"}
              <span style={{ fontWeight: 600, color: "var(--muted)" }}> · {dupForm.label}</span>
            </b>
            <label style={dupLbl}>Copy name
              <input autoFocus value={dupForm.name} onChange={(e) => setDupForm({ ...dupForm, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") submitDup(); if (e.key === "Escape") setDupForm(null); }} style={dupInp} />
            </label>
            {/* v549 · đích chọn bằng DROPDOWN (như kit) — hết dán ID tay */}
            {dupForm.kind === "adset" && (
              <label style={dupLbl}>Target campaign
                {campList.length ? (
                  <select value={dupForm.target} onChange={(e) => setDupForm({ ...dupForm, target: e.target.value })} style={dupInp}>
                    <option value="">— keep current campaign —</option>
                    {/* v557 · ẩn campaign ARCHIVED/DELETED — Meta không cho thêm ad set vào campaign lưu trữ */}
                    {campList.filter((c) => !/ARCHIVED|DELETED/i.test(c.status)).map((c) => <option key={c.id} value={c.id}>{(c.status === "ACTIVE" ? "🟢 " : "⏸ ") + (c.name || c.id)}</option>)}
                  </select>
                ) : (
                  <input value={dupForm.target} onChange={(e) => setDupForm({ ...dupForm, target: e.target.value.replace(/\D/g, "") })} style={dupInp} placeholder="empty = keep current campaign" />
                )}
              </label>
            )}
            {dupForm.kind === "ad" && (
              <label style={dupLbl}>Target ad set
                {ent && Object.keys(ent.adsets).length ? (
                  <select value={dupForm.target} onChange={(e) => setDupForm({ ...dupForm, target: e.target.value })} style={dupInp}>
                    {Object.entries(ent.adsets)
                      .filter(([, s2]) => !/ARCHIVED|DELETED/i.test(s2.status))
                      .sort((x, y) => ((x[1].status === "ACTIVE" ? 0 : 1) - (y[1].status === "ACTIVE" ? 0 : 1)) || String(x[1].name ?? "").localeCompare(String(y[1].name ?? "")))
                      .map(([id, s]) => {
                        const cn = campList.find((c) => c.id === s.campId)?.name ?? "";
                        return <option key={id} value={id}>{(s.status === "ACTIVE" ? "🟢 " : "⏸ ") + (s.name || id) + (s.budget ? ` · $${s.budget}/d` : "") + (cn ? ` · ${cn}` : "")}</option>;
                      })}
                  </select>
                ) : (
                  <input value={dupForm.target} onChange={(e) => setDupForm({ ...dupForm, target: e.target.value.replace(/\D/g, "") })} style={dupInp} placeholder="paste target ad set ID" />
                )}
              </label>
            )}
            {dupForm.kind === "adset" && (
              <label style={dupLbl}>Daily budget $ (empty = keep original)
                <input value={dupForm.budget} onChange={(e) => setDupForm({ ...dupForm, budget: e.target.value.replace(/[^0-9.]/g, "") })} style={dupInp} placeholder="vd 25" />
              </label>
            )}
            {/* v552 · lịch chạy kiểu Meta Ads Kit: ngày + giờ + chip nhanh (ASAP = theo ad set gốc) */}
            {dupForm.kind === "adset" && (() => {
              const sDate = dupForm.start.slice(0, 10);
              const sTime = dupForm.start.length >= 16 ? dupForm.start.slice(11, 16) : "";
              const setStart = (d: string, t: string) => setDupForm({ ...dupForm, start: d ? `${d}T${t || "08:00"}` : "" });
              const dstr = (off: number) => { const x = new Date(Date.now() + off * 86400000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
              const chip = (on: boolean): React.CSSProperties => ({ border: on ? "1.5px solid #16A34A" : "1px solid #C9D2DE", background: on ? "#F0FBF4" : "#fff", color: on ? "#15803D" : "#5B6472", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" });
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#5B6472" }}>START DATE (your local time)</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="date" value={sDate} onChange={(e) => setStart(e.target.value, sTime)} style={{ ...dupInp, flex: 1 }} />
                    <input type="time" value={sTime} onChange={(e) => setStart(sDate || dstr(0), e.target.value)} style={{ ...dupInp, width: 120 }} />
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => setDupForm({ ...dupForm, start: "" })} style={chip(!dupForm.start)}>⚡ ASAP</button>
                    <button type="button" onClick={() => setStart(dstr(0), sTime || "08:00")} style={chip(!!sDate && sDate === dstr(0))}>Today</button>
                    <button type="button" onClick={() => setStart(dstr(1), sTime || "08:00")} style={chip(!!sDate && sDate === dstr(1))}>Tomorrow</button>
                    {["00:00", "08:00", "20:00"].map((t) => (
                      <button key={t} type="button" onClick={() => setStart(sDate || dstr(0), t)} style={chip(!!dupForm.start && sTime === t)}>{t}</button>
                    ))}
                  </div>
                </div>
              );
            })()}
            {dupForm.kind !== "camp" && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: "#5B6472", cursor: "pointer" }}>
                <input type="checkbox" checked={dupForm.deep} onChange={(e) => setDupForm({ ...dupForm, deep: e.target.checked })} style={{ marginTop: 2 }} />
                <span>{dupForm.kind === "adset" ? "Copy WITH the ads inside (keeps creatives/posts)" : "Exact copy of this ad's creative"}</span>
              </label>
            )}
            {/* v576 · MOVE: copy giữ post + tự tắt gốc = chuyển ad sang ad set/campaign khác trong 1 phát */}
            {dupForm.kind === "ad" && dupForm.deep && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: "#5B6472", cursor: "pointer" }}>
                <input type="checkbox" checked={!!dupForm.moveOff} onChange={(e) => setDupForm({ ...dupForm, moveOff: e.target.checked })} style={{ marginTop: 2 }} />
                <span>MOVE — turn OFF the original ad after copying (copy keeps the post &amp; social proof)</span>
              </label>
            )}
            {/* v551 · chọn ADS nào được copy kèm — bỏ tick con không muốn mang theo */}
            {dupForm.kind === "adset" && dupForm.deep && (() => {
              const inSet = adsInSet(dupForm.id);
              if (!inSet.length) return null;
              const nChosen = inSet.filter(([id]) => dupForm.picks[id] !== false).length;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, border: "1px solid #EEF1F5", borderRadius: 10, padding: "8px 10px", maxHeight: 170, overflowY: "auto" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: "#8794A5", letterSpacing: ".3px" }}>ADS TO COPY ({nChosen}/{inSet.length})</span>
                  {inSet.map(([id, a]) => {
                    // v575 · trạng thái từng ad trong danh sách copy — biết con nào đang chạy, con nào đã tắt
                    const on = a.status === "ACTIVE" && a.eff === "ACTIVE";
                    const offByParent = a.status === "ACTIVE" && (a.eff === "ADSET_PAUSED" || a.eff === "CAMPAIGN_PAUSED");
                    return (
                    <label key={id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, cursor: "pointer", opacity: on ? 1 : 0.75 }}>
                      <input type="checkbox" checked={dupForm.picks[id] !== false}
                        onChange={() => setDupForm({ ...dupForm, picks: { ...dupForm.picks, [id]: dupForm.picks[id] === false } })}
                        style={{ accentColor: "#16A34A", flexShrink: 0 }} />
                      {a.thumb && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={a.thumb} alt="" style={{ width: 22, height: 22, objectFit: "cover", borderRadius: 4, flexShrink: 0, border: "1px solid #E3E7EE" }} />
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name || id}</span>
                      <span title={on ? "This ad is delivering" : offByParent ? "Ad switch is on but its ad set/campaign is OFF — not delivering" : "This ad is turned OFF"}
                        style={{ marginLeft: "auto", flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: ".4px", borderRadius: 5, padding: "1px 7px", lineHeight: "14px",
                          background: on ? "#DCFCE7" : "#EEF1F5", color: on ? "#166534" : "#8794A5" }}>
                        {on ? "ACTIVE" : offByParent ? "OFF (parent)" : "OFF"}
                      </span>
                    </label>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setDupForm(null)} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
              <button onClick={submitDup} disabled={!!dupBusy} style={{ border: "none", background: "#1D4ED8", color: "#fff", borderRadius: 10, padding: "8px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: dupBusy ? .6 : 1 }}>
                {dupBusy ? "Working…" : dupForm.kind !== "camp" && dupForm.deep ? "⧉ Duplicate" : "⧉ Dup & pick products →"}
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
