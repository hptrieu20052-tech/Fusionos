import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, ilike } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v648 · XUẤT LINK TẢI toàn bộ file design của 1 SELLER (admin-only).
 * GET /api/designs/export-links?seller=<tên hoặc uuid>[&by=designer]
 * → tải về file CSV: sku, title, kind, filename, size_mb, url — mỗi dòng 1 file.
 * File design nặng (hàng GB/seller) nên KHÔNG zip trên server: dùng CSV này với script
 * download-designs.ps1 (Claude outputs) để tải thẳng từ CDN R2 về máy, bỏ qua file đã có.
 * by=designer → lọc theo designs.designer_id thay vì seller_id.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("seller") ?? "").trim();
  const byDesigner = req.nextUrl.searchParams.get("by") === "designer";
  if (!q) return NextResponse.json({ ok: false, error: "missing ?seller=<name or uuid>" }, { status: 400 });

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const [u] = UUID_RE.test(q)
    ? await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, q)).limit(1)
    : await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(ilike(schema.users.fullName, `%${q}%`)).limit(1);
  if (!u) return NextResponse.json({ ok: false, error: `user "${q}" not found` }, { status: 404 });

  const rows = await db.select({
    sku: schema.designs.skuCode, title: schema.designs.title,
    kind: schema.designFiles.kind, filename: schema.designFiles.filename,
    key: schema.designFiles.storageKey, size: schema.designFiles.sizeBytes,
  }).from(schema.designs)
    .innerJoin(schema.designFiles, eq(schema.designFiles.designId, schema.designs.id))
    .where(byDesigner ? eq(schema.designs.designerId, u.id) : eq(schema.designs.sellerId, u.id))
    .orderBy(schema.designs.skuCode, schema.designFiles.kind);

  // v649 · format=json cho trang /design-export (tải thẳng trong browser qua /api/files/<key>)
  if (req.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json({
      ok: true, user: { id: u.id, name: u.name }, count: rows.length,
      totalMb: Math.round(rows.reduce((a, r) => a + Number(r.size ?? 0), 0) / 1048576),
      files: rows.map((r) => ({
        sku: r.sku, title: r.title, kind: r.kind, filename: r.filename ?? "",
        sizeMb: Number(((Number(r.size ?? 0)) / 1048576).toFixed(2)), key: r.key,
      })),
    });
  }

  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = ["sku,title,kind,filename,size_mb,url"];
  for (const r of rows) {
    const raw = fileUrl(r.key);
    if (!raw) continue;
    const url = raw.startsWith("/") ? new URL(raw, req.nextUrl.origin).toString() : raw;
    lines.push([r.sku, esc(r.title), esc(r.kind), esc(r.filename ?? ""), (Number(r.size ?? 0) / 1048576).toFixed(2), esc(url)].join(","));
  }
  // BOM để Excel mở tiếng Việt không vỡ font
  const csv = "﻿" + lines.join("\r\n");
  const safe = String(u.name ?? "user").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="designs-${safe}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Design-Files": String(lines.length - 1),
    },
  });
}
