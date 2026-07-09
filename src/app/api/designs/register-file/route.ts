import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { isDesignKind, isSingleSide } from "@/lib/design-kinds";

export const dynamic = "force-dynamic";

// POST { designId, key, kind, sha256, sizeBytes } — bước 3 sau khi PUT xong.
// DEDUP: nếu sha256 đã tồn tại → tái dùng storage/thumb/preview của file cũ (tiết kiệm 15-30% dung lượng).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storageKey = b?.storageKey ?? b?.key;
  if (!b?.designId || !storageKey || !b?.sha256 || !isDesignKind(b.kind)) {
    return NextResponse.json({ ok: false, error: "invalid", got: { designId: !!b?.designId, storageKey: !!storageKey, sha256: !!b?.sha256, kind: b?.kind } }, { status: 400 });
  }

  const [dup] = await db.select().from(schema.designFiles).where(eq(schema.designFiles.sha256, b.sha256)).limit(1);

  // Mỗi MẶT thiết kế chỉ giữ 1 file (front/back/sleeve/trang…) — upload mới thay file cũ cùng mặt. Mockup/video thì nhiều file.
  if (isSingleSide(b.kind)) {
    await db.delete(schema.designFiles).where(and(eq(schema.designFiles.designId, b.designId), eq(schema.designFiles.kind, b.kind)));
  }

  const [row] = await db.insert(schema.designFiles).values(
    dup
      ? {
          designId: b.designId, kind: b.kind, filename: b.filename ?? null, uploadedBy: session.sub,
          storageKey: dup.storageKey, thumbKey: dup.thumbKey, previewKey: dup.previewKey,
          sha256: b.sha256, sizeBytes: dup.sizeBytes, width: dup.width, height: dup.height,
          processingStatus: dup.processingStatus,
        }
      : {
          designId: b.designId, kind: b.kind, filename: b.filename ?? null, uploadedBy: session.sub, storageKey,
          sha256: b.sha256, sizeBytes: Number(b.sizeBytes ?? 0),
          processingStatus: "uploaded",
        }
  ).returning();

  return NextResponse.json({ ok: true, file: row, deduped: !!dup });
}
