import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { runMetaRuleEngine, undoAutoPause, rotatePause, getRuleConfig, saveRuleConfig, type RuleConfig } from "@/lib/meta-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * v570 · Rule engine Meta ads.
 * GET  → { state: [{adId, verdict, phase, reason, autoPaused, pauseReason, resumeAt, since}], config, lastRunAt, log }
 * POST { action: "run" }                    → chạy engine ngay (bỏ gate 2h)
 * POST { action: "undo", adId }             → bật lại ad engine đã tự tắt (không bao giờ tự tắt lại)
 * POST { action: "rotate", adId, adName }   → xoay vòng: tạm tắt ad này, tự bật lại sau 48h
 * POST { action: "config", config: {...} }  → chỉnh ngưỡng (số nào gửi thì đổi số đó)
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const [state, log, { cfg, lastRunAt }] = await Promise.all([
    db.select().from(schema.metaRuleState).catch(() => []),
    db.select().from(schema.metaRuleLog).orderBy(desc(schema.metaRuleLog.createdAt)).limit(50).catch(() => []),
    getRuleConfig(),
  ]);
  return NextResponse.json({ ok: true, state, log, config: cfg, lastRunAt });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null) as { action?: string; adId?: string; adName?: string; config?: Partial<RuleConfig> } | null;
  const action = String(b?.action ?? "");

  if (action === "run") {
    const r = await runMetaRuleEngine({ force: true });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "undo") {
    if (!b?.adId) return NextResponse.json({ ok: false, error: "adId required" }, { status: 400 });
    const r = await undoAutoPause(String(b.adId));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "rotate") {
    if (!b?.adId) return NextResponse.json({ ok: false, error: "adId required" }, { status: 400 });
    const r = await rotatePause(String(b.adId), String(b.adName ?? b.adId));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "config") {
    if (!b?.config || typeof b.config !== "object") return NextResponse.json({ ok: false, error: "config required" }, { status: 400 });
    const merged = await saveRuleConfig(b.config);
    return NextResponse.json({ ok: true, config: merged });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
