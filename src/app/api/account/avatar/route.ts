import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/account/avatar — multipart { file }
 * Upload avatar QUA SERVER (browser PUT thẳng lên R2 dính CORS trên máy chưa cấu hình).
 * Server ghi R2 + cập nhật users.avatar_key luôn, trả avatarUrl.
 */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false }, { status: 401 });
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "no file" }, { status: 400 });
  if (!/^image\//.test(file.type)) return NextResponse.json({ ok: false, error: "image only" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ ok: false, error: "max 5MB" }, { status: 400 });

  const ext = (file.name.split(".").pop() || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const key = `avatars/${s.sub}-${Date.now()}.${ext}`;
  await writeFile(key, Buffer.from(await file.arrayBuffer()), file.type);
  await db.update(schema.users).set({ avatarKey: key }).where(eq(schema.users.id, s.sub));
  return NextResponse.json({ ok: true, avatarKey: key, avatarUrl: fileUrl(key) });
}
