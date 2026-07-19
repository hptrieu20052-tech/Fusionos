import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET — map TÊN nhà fulfill → URL logo đã upload (favicon). Cho MỌI user đăng nhập
// (SupplierLogo hiển thị ở Orders/SKU mapping… nơi seller không có quyền settings).
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ ok: false }, { status: 401 });
  const ffs = await db.select({ name: schema.fulfillers.name, logoKey: schema.fulfillers.logoKey }).from(schema.fulfillers);
  const logos: Record<string, string> = {};
  for (const f of ffs) {
    const u = fileUrl(f.logoKey);
    if (u) logos[f.name.trim().toLowerCase()] = u;
  }
  return NextResponse.json({ ok: true, logos }, { headers: { "Cache-Control": "private, max-age=300" } });
}
