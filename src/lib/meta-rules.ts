/**
 * v570 · RULE ENGINE Meta ads — chấm verdict từng ad theo GIAI ĐOẠN CHI TIÊU (lifetime).
 * v571 · MẶC ĐỊNH CHỈ BADGE — người tự quyết tắt/bật (yêu cầu 22/9). Nhánh auto-pause vẫn còn
 * nguyên nhưng nằm sau công tắc config.autoPause (0 = tắt, mặc định; 1 = máy tự tắt case chắc chắn).
 *
 * Chạy trong cron tick, gate engineEveryH (mặc định 2h). Số liệu LIFETIME lấy thẳng từ
 * Marketing API (date_preset=maximum) — không dùng cửa sổ 7 ngày của bảng meta_insights,
 * vì rule dựa trên tổng chi TÍCH LUỸ của ad. ROAS 3/7 ngày cho camp MAIN đọc từ DB.
 *
 * Camp TEST (tên chứa "test"):
 *   P0  spend<$8 || impr<400            → WAITING (cấm mọi cảnh báo tắt)
 *       tuổi>48h & impr<300 & sibling>800 → STARVED (warn xoay vòng)
 *   P1  $8–$28: ctr<1.5 & atc=0         → KILL + AUTO-PAUSE
 *              ctr 1.5–2 & atc=0        → GRACE (đến $18 vẫn vậy → KILL + AUTO-PAUSE)
 *              ctr≥2 || atc≥1           → ALIVE
 *   P2  ≥$28:  pur=0                    → KILL (auto-pause CHỈ khi ctr<2 VÀ verdict KILL đã giữ
 *              ≥12h — buffer attribution lag; ctr≥2.5 || atc≥3 → CHECK, người quyết)
 *              pur≥1                    → WINNER (đề xuất dup sang MAIN giữ post)
 * Camp MAIN (tên chứa "main") — KHÔNG BAO GIỜ auto-pause:
 *   ROAS 3d < 2.0 (spend3 đủ lớn)       → MAIN_WATCH (hạ budget, đừng tăng)
 *   ROAS 7d < 1.5                       → MAIN_RED
 *   Budget ad set tăng >25% trong 72h   → SCALE_FAST (hàng adset-level, ad_id="adset:<id>")
 * Mỗi ad chỉ bị auto-pause 1 LẦN trọn đời (cờ auto_paused) + log + nút Undo trên UI.
 * Xoay vòng (rotation): pause_reason="rotation" + resume_at → engine tự BẬT LẠI khi đến giờ.
 */
import { db, schema } from "@/lib/db";
import { and, eq, gte, inArray, sql, desc } from "drizzle-orm";

export const RULE_VERSION = "v570";
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

export type RuleConfig = {
  /** 0 = CHỈ BADGE, người tự quyết (mặc định — theo yêu cầu 22/9). 1 = máy tự tắt case chắc chắn. */
  autoPause: number;
  p0Spend: number; p0Impr: number; graceMax: number; p2Spend: number;
  ctrKill: number; ctrAlive: number; ctrCheck: number; atcCheck: number;
  starveAgeH: number; starveImpr: number; starveSibImpr: number;
  adsetMinAlive: number; adsetMaxActive: number; campKillSpend7d: number;
  mainRoas3: number; mainRoas7: number; mainMinSpend3: number; mainMinSpend7: number;
  mainBudgetJumpPct: number; mainBudgetJumpH: number;
  p2BufferH: number; rotationH: number; engineEveryH: number;
};
export const DEFAULT_RULES: RuleConfig = {
  autoPause: 0,
  p0Spend: 8, p0Impr: 400, graceMax: 18, p2Spend: 28,
  ctrKill: 1.5, ctrAlive: 2, ctrCheck: 2.5, atcCheck: 3,
  starveAgeH: 48, starveImpr: 300, starveSibImpr: 800,
  adsetMinAlive: 3, adsetMaxActive: 4, campKillSpend7d: 60,
  mainRoas3: 2.0, mainRoas7: 1.5, mainMinSpend3: 10, mainMinSpend7: 20,
  mainBudgetJumpPct: 25, mainBudgetJumpH: 72,
  p2BufferH: 12, rotationH: 48, engineEveryH: 2,
};

export async function getRuleConfig(): Promise<{ cfg: RuleConfig; lastRunAt: Date | null }> {
  try {
    const [row] = await db.select().from(schema.metaRuleConfig).limit(1);
    return { cfg: { ...DEFAULT_RULES, ...((row?.config ?? {}) as Partial<RuleConfig>) }, lastRunAt: row?.engineLastRunAt ?? null };
  } catch { return { cfg: DEFAULT_RULES, lastRunAt: null }; }
}
export async function saveRuleConfig(patch: Partial<RuleConfig>): Promise<RuleConfig> {
  const { cfg } = await getRuleConfig();
  const merged: RuleConfig = { ...cfg };
  for (const [k, v] of Object.entries(patch)) {
    const n = Number(v);
    if (Number.isFinite(n) && k in DEFAULT_RULES) (merged as Record<string, number>)[k] = n;
  }
  await db.insert(schema.metaRuleConfig).values({ id: 1, config: merged, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.metaRuleConfig.id, set: { config: merged, updatedAt: sql`now()` } });
  return merged;
}

type Action = { action_type: string; value: string };
const pick = (arr: Action[] | undefined, keys: string[]): number => {
  for (const k of keys) { const f = (arr ?? []).find((a) => a.action_type === k); if (f) return Number(f.value) || 0; }
  return 0;
};
async function fbList(url: string, token: string, maxPages = 8): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next = url;
  for (let p = 0; p < maxPages && next; p++) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(45000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(String(j.error?.message ?? res.status).slice(0, 250));
    out.push(...((j.data ?? []) as Record<string, unknown>[]));
    next = j.paging?.next ?? "";
  }
  return out;
}
async function fbSetStatus(token: string, id: string, status: "ACTIVE" | "PAUSED"): Promise<boolean> {
  const res = await fetch(`${G}/${id}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status }), signal: AbortSignal.timeout(20000),
  });
  return res.ok;
}

const isTest = (name: string) => /test/i.test(name);
const isMain = (name: string) => /main/i.test(name);

export type EngineSummary = {
  ok: boolean; skipped?: string; ads?: number; verdicts?: Record<string, number>;
  autoPaused?: string[]; resumed?: string[]; error?: string;
};

/** Chạy engine. force=true bỏ qua gate thời gian (nút Run now). */
export async function runMetaRuleEngine(opts: { force?: boolean } = {}): Promise<EngineSummary> {
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  const acctRaw = process.env.META_AD_ACCOUNT_ID ?? "";
  if (!token || !acctRaw) return { ok: false, skipped: "META env missing" };
  const act = acctRaw.startsWith("act_") ? acctRaw : `act_${acctRaw}`;

  const { cfg, lastRunAt } = await getRuleConfig();
  if (!opts.force && lastRunAt && Date.now() - lastRunAt.getTime() < cfg.engineEveryH * 3600_000) {
    return { ok: true, skipped: `ran ${Math.round((Date.now() - lastRunAt.getTime()) / 60000)}m ago` };
  }

  try {
    // ---- 1. Kéo cấu trúc + LIFETIME insights ----
    const [camps, adsets, ads, life] = await Promise.all([
      fbList(`${G}/${act}/campaigns?fields=id,name,effective_status&limit=200`, token),
      fbList(`${G}/${act}/adsets?fields=id,name,campaign_id,status,effective_status,daily_budget&limit=200`, token),
      fbList(`${G}/${act}/ads?fields=id,name,adset_id,campaign_id,status,effective_status,created_time&limit=300`, token),
      fbList(`${G}/${act}/insights?level=ad&date_preset=maximum&fields=ad_id,spend,impressions,actions,action_values&limit=500`, token),
    ]);
    const campName = new Map(camps.map((c) => [String(c.id), String(c.name ?? "")]));
    const lifeBy = new Map(life.map((r) => [String(r.ad_id), {
      spend: Number(r.spend) || 0,
      impr: Number(r.impressions) || 0,
      lc: pick(r.actions as Action[], ["link_click"]),
      atc: pick(r.actions as Action[], ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]),
      pur: pick(r.actions as Action[], ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
      rev: pick(r.action_values as Action[], ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
    }]));

    // ---- 2. ROAS 3/7 ngày cho MAIN — đọc DB meta_insights (đã sync nền) ----
    const d3 = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
    const d7 = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const recent = await db.select({ adId: schema.metaInsights.adId, day: schema.metaInsights.day, spend: schema.metaInsights.spend, revenue: schema.metaInsights.revenue })
      .from(schema.metaInsights).where(gte(schema.metaInsights.day, d7))
      .catch(() => [] as { adId: string; day: string; spend: string | null; revenue: string | null }[]);
    const w3 = new Map<string, { s: number; r: number }>(), w7 = new Map<string, { s: number; r: number }>();
    for (const r of recent) {
      const s = Number(r.spend) || 0, rv = Number(r.revenue) || 0;
      const a7 = w7.get(r.adId) ?? { s: 0, r: 0 }; a7.s += s; a7.r += rv; w7.set(r.adId, a7);
      if (r.day >= d3) { const a3 = w3.get(r.adId) ?? { s: 0, r: 0 }; a3.s += s; a3.r += rv; w3.set(r.adId, a3); }
    }

    // ---- 3. State cũ + impressions theo ad set (bắt STARVED) ----
    const prevRows = await db.select().from(schema.metaRuleState).catch(() => [] as (typeof schema.metaRuleState.$inferSelect)[]);
    const prev = new Map<string, typeof schema.metaRuleState.$inferSelect>(prevRows.map((r) => [r.adId, r]));
    const imprByAdset = new Map<string, { adId: string; impr: number }[]>();
    for (const a of ads) {
      const l = lifeBy.get(String(a.id));
      const list = imprByAdset.get(String(a.adset_id)) ?? [];
      list.push({ adId: String(a.id), impr: l?.impr ?? 0 });
      imprByAdset.set(String(a.adset_id), list);
    }

    // ---- 4. Chấm verdict từng ad ----
    const now = new Date();
    const upserts: (typeof schema.metaRuleState.$inferInsert)[] = [];
    const autoPaused: string[] = [];
    const resumed: string[] = [];
    const counts: Record<string, number> = {};
    const logRows: (typeof schema.metaRuleLog.$inferInsert)[] = [];

    for (const a of ads) {
      const adId = String(a.id), adName = String(a.name ?? adId);
      const camp = campName.get(String(a.campaign_id)) ?? "";
      const eff = String(a.effective_status ?? "");
      const p = prev.get(adId);

      // Rotation hết cooldown → tự bật lại (pause kỹ thuật, khác pause verdict)
      if (p?.pauseReason === "rotation" && p.resumeAt && p.resumeAt <= now && String(a.status) === "PAUSED") {
        if (await fbSetStatus(token, adId, "ACTIVE").catch(() => false)) {
          resumed.push(adName);
          logRows.push({ adId, adName, verdict: p.verdict, action: "rotate_resume", metrics: p.metrics, ruleVersion: RULE_VERSION });
          await db.update(schema.metaRuleState).set({ pauseReason: null, resumeAt: null, updatedAt: now }).where(eq(schema.metaRuleState.adId, adId));
        }
        continue; // vòng sau chấm lại như ad thường
      }

      if (!isTest(camp) && !isMain(camp)) continue;   // camp ngoài hệ TEST/MAIN → không chấm
      if (eff !== "ACTIVE") continue;                  // ad đã tắt (kể cả engine tắt) → giữ state cũ cho log/Undo
      const l = lifeBy.get(adId) ?? { spend: 0, impr: 0, lc: 0, atc: 0, pur: 0, rev: 0 };
      const ctr = l.impr ? (100 * l.lc) / l.impr : 0;
      const ageH = a.created_time ? (Date.now() - Date.parse(String(a.created_time))) / 3600_000 : 0;
      const metrics = { spend: +l.spend.toFixed(2), impr: l.impr, ctr: +ctr.toFixed(2), atc: l.atc, pur: l.pur, rev: +l.rev.toFixed(2), ageH: Math.round(ageH) };

      let verdict = "", phase = "", reason = "";
      let wantAutoPause = false;

      if (isMain(camp)) {
        // ---- MAIN: chỉ warn, KHÔNG BAO GIỜ auto-pause (máy không được tự tắt nguồn tiền) ----
        phase = "MAIN";
        const m3 = w3.get(adId) ?? { s: 0, r: 0 }, m7 = w7.get(adId) ?? { s: 0, r: 0 };
        const roas3 = m3.s ? m3.r / m3.s : 0, roas7 = m7.s ? m7.r / m7.s : 0;
        if (m7.s >= cfg.mainMinSpend7 && roas7 < cfg.mainRoas7) {
          verdict = "MAIN_RED"; reason = `7-day ROAS ${roas7.toFixed(2)} < ${cfg.mainRoas7} ($${m7.s.toFixed(0)} spent) — losing money, act now`;
        } else if (m3.s >= cfg.mainMinSpend3 && roas3 < cfg.mainRoas3) {
          verdict = "MAIN_WATCH"; reason = `3-day ROAS ${roas3.toFixed(2)} < ${cfg.mainRoas3} — step budget DOWN one level, do not raise`;
        } else { verdict = "ALIVE"; reason = `3d ROAS ${roas3 ? roas3.toFixed(2) : "—"} · 7d ROAS ${roas7 ? roas7.toFixed(2) : "—"}`; }
      } else if (l.spend >= cfg.p2Spend) {
        // ---- P2 — PHÁN ĐƠN ----
        phase = "P2";
        if (l.pur >= 1) { verdict = "WINNER"; reason = `${l.pur} purchase(s), ROAS ${l.spend ? (l.rev / l.spend).toFixed(2) : "—"} at $${l.spend.toFixed(0)} — duplicate to MAIN (keep post ID), rotate a new design into this slot`; }
        else if (ctr >= cfg.ctrCheck || l.atc >= cfg.atcCheck) { verdict = "CHECK"; reason = `$${l.spend.toFixed(0)} spent, 0 purchases BUT CTR ${ctr.toFixed(2)}% / ${l.atc} ATC are good — check landing page & price, your call`; }
        else {
          verdict = "KILL";
          reason = `$${l.spend.toFixed(0)} spent, 0 purchases — turn it OFF (note: Meta can report purchases 24-48h late)`;
          // Nếu BẬT autoPause: chỉ tắt khi ctr < ctrAlive VÀ verdict KILL đã giữ ≥ p2BufferH (đệm attribution)
          const heldH = p && p.verdict === "KILL" ? (Date.now() - new Date(p.since).getTime()) / 3600_000 : 0;
          if (ctr < cfg.ctrAlive && heldH >= cfg.p2BufferH) wantAutoPause = true;
        }
      } else if (l.spend < cfg.p0Spend || l.impr < cfg.p0Impr) {
        // ---- P0 — CHƯA ĐỦ DATA ----
        phase = "P0";
        const sibs = imprByAdset.get(String(a.adset_id)) ?? [];
        const maxSib = Math.max(0, ...sibs.filter((x) => x.adId !== adId).map((x) => x.impr));
        if (ageH > cfg.starveAgeH && l.impr < cfg.starveImpr && maxSib > cfg.starveSibImpr) {
          verdict = "STARVED"; reason = `${Math.round(ageH)}h old with only ${l.impr} impressions while a sibling has ${maxSib} — Meta is starving it; rotate: pause the top-spend sibling for ${cfg.rotationH}h`;
        } else { verdict = "WAITING"; reason = `$${l.spend.toFixed(2)} / ${l.impr} impr — not enough data, no kill warnings allowed`; }
      } else {
        // ---- P1 — PHÁN CTR ($8 → $28) ----
        phase = "P1";
        if (ctr >= cfg.ctrAlive || l.atc >= 1) { verdict = "ALIVE"; reason = `CTR ${ctr.toFixed(2)}% · ${l.atc} ATC — keep running`; }
        else if (ctr < cfg.ctrKill) { verdict = "KILL"; reason = `CTR ${ctr.toFixed(2)}% < ${cfg.ctrKill}% with 0 ATC at $${l.spend.toFixed(0)} — dead creative`; wantAutoPause = true; }
        else if (l.spend >= cfg.graceMax) { verdict = "KILL"; reason = `grace expired: $${l.spend.toFixed(0)} with 0 ATC and CTR ${ctr.toFixed(2)}% < ${cfg.ctrAlive}%`; wantAutoPause = true; }
        else { verdict = "GRACE"; reason = `CTR ${ctr.toFixed(2)}% (${cfg.ctrKill}–${cfg.ctrAlive}%) with 0 ATC — $${(cfg.graceMax - l.spend).toFixed(0)} of grace left; still 0 ATC at $${cfg.graceMax} → KILL`; }
      }

      // AUTO-PAUSE: mặc định TẮT (autoPause=0 — chỉ badge, người tự quyết, yêu cầu 22/9).
      // Bật autoPause=1 trong config thì máy mới tự tắt case chắc chắn; mỗi ad chỉ 1 LẦN trọn đời;
      // MAIN không bao giờ vào nhánh này.
      if (wantAutoPause && cfg.autoPause > 0 && !p?.autoPaused) {
        if (await fbSetStatus(token, adId, "PAUSED").catch(() => false)) {
          autoPaused.push(adName);
          logRows.push({ adId, adName, verdict, action: "auto_pause", metrics, ruleVersion: RULE_VERSION });
          upserts.push({ adId, verdict, phase, reason, metrics, since: p && p.verdict === verdict ? p.since : now, autoPaused: true, autoPausedAt: now, pauseReason: "verdict", ruleVersion: RULE_VERSION, updatedAt: now });
          counts[verdict] = (counts[verdict] ?? 0) + 1;
          continue;
        }
        reason += " (auto-pause call failed — turn it off manually)";
      }
      upserts.push({
        adId, verdict, phase, reason, metrics,
        since: p && p.verdict === verdict ? p.since : now,
        autoPaused: p?.autoPaused ?? false, autoPausedAt: p?.autoPausedAt ?? null,
        pauseReason: p?.pauseReason ?? null, resumeAt: p?.resumeAt ?? null,
        ruleVersion: RULE_VERSION, updatedAt: now,
      });
      counts[verdict] = (counts[verdict] ?? 0) + 1;
    }

    // ---- 5. SCALE_FAST cho ad set MAIN: budget tăng >X% trong Yh (hàng adset-level) ----
    for (const s of adsets) {
      const sid = String(s.id);
      const camp = campName.get(String(s.campaign_id)) ?? "";
      const budget = (Number(s.daily_budget) || 0) / 100;
      if (!budget) continue;
      // snapshot: chỉ ghi khi budget ĐỔI so với lần ghi cuối (bảng gọn)
      try {
        const [last] = await db.select().from(schema.metaBudgetLog).where(eq(schema.metaBudgetLog.adsetId, sid)).orderBy(desc(schema.metaBudgetLog.createdAt)).limit(1);
        if (!last || Number(last.budget) !== budget) await db.insert(schema.metaBudgetLog).values({ adsetId: sid, budget: budget.toFixed(2) });
        if (isMain(camp) && String(s.effective_status ?? s.status) === "ACTIVE") {
          const sinceT = new Date(Date.now() - cfg.mainBudgetJumpH * 3600_000);
          const hist = await db.select().from(schema.metaBudgetLog)
            .where(and(eq(schema.metaBudgetLog.adsetId, sid), gte(schema.metaBudgetLog.createdAt, sinceT)));
          const minB = Math.min(...hist.map((h) => Number(h.budget)), budget);
          const jumpPct = minB > 0 ? (100 * (budget - minB)) / minB : 0;
          const rowId = `adset:${sid}`;
          if (jumpPct > cfg.mainBudgetJumpPct) {
            upserts.push({ adId: rowId, verdict: "SCALE_FAST", phase: "ADSET", reason: `budget +${jumpPct.toFixed(0)}% in ${cfg.mainBudgetJumpH}h ($${minB.toFixed(0)} → $${budget.toFixed(0)}) — faster than safe scaling speed`, metrics: { budget, minB: +minB.toFixed(2), jumpPct: +jumpPct.toFixed(0) }, since: prev.get(rowId)?.verdict === "SCALE_FAST" ? prev.get(rowId)!.since : now, ruleVersion: RULE_VERSION, updatedAt: now });
            counts.SCALE_FAST = (counts.SCALE_FAST ?? 0) + 1;
          } else if (prev.has(rowId)) {
            await db.delete(schema.metaRuleState).where(eq(schema.metaRuleState.adId, rowId));
          }
        }
      } catch { /* budget log là phụ */ }
    }

    // ---- 6. Ghi state + log + mốc chạy ----
    for (const u of upserts) {
      await db.insert(schema.metaRuleState).values(u).onConflictDoUpdate({
        target: schema.metaRuleState.adId,
        set: {
          verdict: sql`excluded.verdict`, phase: sql`excluded.phase`, reason: sql`excluded.reason`,
          metrics: sql`excluded.metrics`, since: sql`excluded.since`,
          autoPaused: sql`excluded.auto_paused`, autoPausedAt: sql`excluded.auto_paused_at`,
          pauseReason: sql`excluded.pause_reason`, resumeAt: sql`excluded.resume_at`,
          ruleVersion: sql`excluded.rule_version`, updatedAt: sql`now()`,
        },
      });
    }
    if (logRows.length) await db.insert(schema.metaRuleLog).values(logRows);
    await db.insert(schema.metaRuleConfig).values({ id: 1, config: cfg, engineLastRunAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: schema.metaRuleConfig.id, set: { engineLastRunAt: now, updatedAt: sql`now()` } });

    return { ok: true, ads: upserts.length, verdicts: counts, autoPaused, resumed };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 250) };
  }
}

/** Undo: bật lại ad engine đã tự tắt (cờ auto_paused GIỮ NGUYÊN → không bao giờ tự tắt lại). */
export async function undoAutoPause(adId: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  if (!token) return { ok: false, error: "META_SYSTEM_TOKEN missing" };
  const [p] = await db.select().from(schema.metaRuleState).where(eq(schema.metaRuleState.adId, adId)).limit(1);
  if (!p?.autoPaused) return { ok: false, error: "this ad was not auto-paused by the rule engine" };
  if (!(await fbSetStatus(token, adId, "ACTIVE").catch(() => false))) return { ok: false, error: "Meta rejected the status change" };
  await db.update(schema.metaRuleState).set({ pauseReason: null, updatedAt: new Date() }).where(eq(schema.metaRuleState.adId, adId));
  await db.insert(schema.metaRuleLog).values({ adId, adName: null, verdict: p.verdict, action: "undo", metrics: p.metrics, ruleVersion: RULE_VERSION });
  return { ok: true };
}

/** Xoay vòng STARVED: tạm tắt 1 ad (top-spend do UI chọn) với hẹn giờ tự bật lại sau rotationH. */
export async function rotatePause(adId: string, adName: string): Promise<{ ok: boolean; resumeAt?: string; error?: string }> {
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  if (!token) return { ok: false, error: "META_SYSTEM_TOKEN missing" };
  const { cfg } = await getRuleConfig();
  if (!(await fbSetStatus(token, adId, "PAUSED").catch(() => false))) return { ok: false, error: "Meta rejected the status change" };
  const resumeAt = new Date(Date.now() + cfg.rotationH * 3600_000);
  await db.insert(schema.metaRuleState)
    .values({ adId, verdict: "ROTATED", phase: "P0", reason: `rotation pause — auto-resumes ${resumeAt.toISOString().slice(0, 16)}Z`, pauseReason: "rotation", resumeAt, ruleVersion: RULE_VERSION })
    .onConflictDoUpdate({ target: schema.metaRuleState.adId, set: { pauseReason: sql`'rotation'`, resumeAt, updatedAt: sql`now()` } });
  await db.insert(schema.metaRuleLog).values({ adId, adName, verdict: "ROTATED", action: "rotate_pause", metrics: null, ruleVersion: RULE_VERSION });
  return { ok: true, resumeAt: resumeAt.toISOString() };
}
