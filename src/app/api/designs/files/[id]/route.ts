import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// PATCH /api/designs/files/[id] — đổi loại file (front/back/mockup/video). Đổi sang front/back mà mặt đó đã có file → tự HOÁN ĐỔI.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const kind = String(b?.kind ?? "");
  const allowed = ["mockup", "video", "design_front", "design_back", "sleeve_left", "sleeve_right",
    "cover_front", "back_cover", "month_01", "month_02", "month_03", "month_04", "month_05", "month_06",
    "month_07", "month_08", "month_09", "month_10", "month_11", "month_12"];
  if (!allowed.includes(kind)) {
    return NextResponse.json({ ok: false, error: "kind không hợp lệ" }, { status: 400 });
  }
  const [f] = await db.select().from(schema.designFiles).where(eq(schema.designFiles.id, params.id)).limit(1);
  if (!f) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (f.kind === kind) return NextResponse.json({ ok: true, swapped: false });

  // Nếu chuyển sang front/back mà mặt đó đã có file khác → hoán đổi loại của 2 file
  let swapped = false;
  if (kind === "design_front" || kind === "design_back") {
    const [other] = await db.select().from(schema.designFiles)
      .where(and(eq(schema.designFiles.designId, f.designId), eq(schema.designFiles.kind, kind)))
      .limit(1);
    if (other && other.id !== f.id) {
      await db.update(schema.designFiles).set({ kind: f.kind }).where(eq(schema.designFiles.id, other.id));
      swapped = true;
    }
  }
  await db.update(schema.designFiles).set({ kind }).where(eq(schema.designFiles.id, params.id));
  return NextResponse.json({ ok: true, swapped });
}

// DELETE /api/designs/files/[id] — xoá 1 file khỏi design (bản ghi DB; file storage giữ lại vì có thể dedup dùng chung)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const [f] = await db.select().from(schema.designFiles).where(eq(schema.designFiles.id, params.id)).limit(1);
  if (!f) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  await db.delete(schema.designFiles).where(eq(schema.designFiles.id, params.id));
  return NextResponse.json({ ok: true });
}
