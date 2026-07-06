import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { readFile, writeFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { fileId } — sinh thumbnail 300px + preview 1200px WebP.
// Dev: chạy inline. Production: chuyển logic này sang BullMQ worker, trigger bằng R2 event.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.fileId) return NextResponse.json({ ok: false, error: "fileId required" }, { status: 400 });

  const [f] = await db.select().from(schema.designFiles).where(eq(schema.designFiles.id, b.fileId)).limit(1);
  if (!f) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (f.processingStatus === "ready") return NextResponse.json({ ok: true, already: true });
  if (f.kind === "video") {
    await db.update(schema.designFiles).set({ processingStatus: "ready" }).where(eq(schema.designFiles.id, f.id));
    return NextResponse.json({ ok: true, skipped: "video" });
  }

  try {
    await db.update(schema.designFiles).set({ processingStatus: "processing" }).where(eq(schema.designFiles.id, f.id));
    const sharp = (await import("sharp")).default;
    const src = await readFile(f.storageKey);
    const img = sharp(src, { limitInputPixels: 900_000_000 });
    const meta = await img.metadata();

    const thumbKey = f.storageKey.replace(/(\.[a-zA-Z0-9]+)?$/, "") + ".thumb.webp";
    const previewKey = f.storageKey.replace(/(\.[a-zA-Z0-9]+)?$/, "") + ".preview.webp";
    const [thumb, preview] = await Promise.all([
      sharp(src).resize(300, 300, { fit: "inside" }).webp({ quality: 78 }).toBuffer(),
      sharp(src).resize(1200, 1200, { fit: "inside" }).webp({ quality: 85 }).toBuffer(),
    ]);
    await Promise.all([writeFile(thumbKey, thumb, "image/webp"), writeFile(previewKey, preview, "image/webp")]);

    await db.update(schema.designFiles).set({
      thumbKey, previewKey, width: meta.width, height: meta.height, processingStatus: "ready",
    }).where(eq(schema.designFiles.id, f.id));

    return NextResponse.json({ ok: true, thumbKey, previewKey, thumbSize: thumb.length, previewSize: preview.length });
  } catch (e) {
    await db.update(schema.designFiles).set({ processingStatus: "failed" }).where(eq(schema.designFiles.id, f.id));
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
