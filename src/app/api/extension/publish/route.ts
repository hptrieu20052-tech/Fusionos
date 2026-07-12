import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/extension/publish (admin) — multipart { version, notes?, file: zip }
 * → ghi extensions/fusion-order-sync.zip + extensions/version.json lên R2.
 * Mọi seller thấy badge NEW trong ≤6h (extension check /api/extension/version), KHÔNG cần deploy.
 */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false }, { status: 403 });
  const fd = await req.formData().catch(() => null);
  if (!fd) return NextResponse.json({ ok: false, error: "invalid form" }, { status: 400 });
  const version = String(fd.get("version") ?? "").trim();
  const notes = String(fd.get("notes") ?? "").trim();
  const file = fd.get("file");
  if (!/^\d+\.\d+\.\d+$/.test(version)) return NextResponse.json({ ok: false, error: "Version must be x.y.z (must match manifest.json in the zip)" }, { status: 400 });
  if (!(file instanceof File) || !file.name.endsWith(".zip")) return NextResponse.json({ ok: false, error: "Attach the extension .zip" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Zip too large (>15MB)" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile("extensions/fusion-order-sync.zip", buf, "application/zip");
  await writeFile("extensions/version.json", Buffer.from(JSON.stringify({ version, notes, updatedAt: new Date().toISOString() })), "application/json");
  return NextResponse.json({ ok: true, version });
}
