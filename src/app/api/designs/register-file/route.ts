import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// POST { designId, key, kind, sha256, sizeBytes } — bước 3 sau khi PUT xong.
// DEDUP: nếu sha256 đã tồn tại → tái dùng storage/thumb/preview của file cũ (tiết kiệm 15-30% dung lượng).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.designId || !b?.key || !b?.sha256 || !schema.designFiles.kind.enumValues.includes(b.kind)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const [dup] = await db.select().from(schema.designFiles).where(eq(schema.designFiles.sha256, b.sha256)).limit(1);

  const [row] = await db.insert(schema.designFiles).values(
    dup
      ? {
          designId: b.designId, kind: b.kind,
          storageKey: dup.storageKey, thumbKey: dup.thumbKey, previewKey: dup.previewKey,
          sha256: b.sha256, sizeBytes: dup.sizeBytes, width: dup.width, height: dup.height,
          processingStatus: dup.processingStatus,
        }
      : {
          designId: b.designId, kind: b.kind, storageKey: b.key,
          sha256: b.sha256, sizeBytes: Number(b.sizeBytes ?? 0),
          processingStatus: "uploaded",
        }
  ).returning();

  return NextResponse.json({ ok: true, file: row, deduped: !!dup });
}
