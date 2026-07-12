import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/admin/users/contract — multipart { userId, file } (admin)
// Upload hợp đồng QUA SERVER — tránh CORS khi PUT thẳng R2.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false }, { status: 403 });
  const fd = await req.formData().catch(() => null);
  const userId = String(fd?.get("userId") ?? "");
  const file = fd?.get("file");
  if (!userId || !(file instanceof File)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const OK = ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"];
  if (!OK.includes(file.type)) return NextResponse.json({ ok: false, error: "Word (.doc/.docx) or PDF only" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ ok: false, error: "max 15MB" }, { status: 400 });

  const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `contracts/${Date.now()}-${clean}`;
  await writeFile(key, Buffer.from(await file.arrayBuffer()), file.type);
  await db.update(schema.users).set({ contractKey: key }).where(eq(schema.users.id, userId));
  return NextResponse.json({ ok: true, contractKey: key, contractUrl: fileUrl(key) });
}
