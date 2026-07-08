import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, or, ilike } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf, hasRestriction } from "@/lib/rbac";
import { parseVariant } from "@/lib/variant";

export const dynamic = "force-dynamic";

// GET /api/fulfillers/variants?ff=<id>&q=<search>&limit=200
// Tìm variant của 1 nhà fulfill (lọc ở server, giới hạn kết quả) — thay cho việc
// nạp toàn bộ catalog vào form. Gõ mới nạp → chỉ hiện SKU cần.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const ff = sp.get("ff");
  if (!ff) return NextResponse.json({ ok: false, error: "missing ff" }, { status: 400 });
  const q = (sp.get("q") ?? "").trim();
  const pinnedOnly = sp.get("pinned") === "1";
  // Nạp SP ghim (mặc định form) → lấy ĐỦ để dropdown Style/Provider/Color/Size không thiếu. Tìm kiếm thì cap 500.
  const limit = (pinnedOnly && !q)
    ? Math.min(Math.max(Number(sp.get("limit")) || 5000, 1), 8000)
    : Math.min(Math.max(Number(sp.get("limit")) || 200, 1), 500);

  const conds = [eq(schema.skuMappings.active, true), eq(schema.skuMappings.fulfillerId, ff)];
  // Không tìm kiếm → chỉ trả SP đã ghim (mặc định form). Có tìm kiếm → tìm toàn bộ để chọn SP mới.
  if (pinnedOnly && !q) conds.push(eq(schema.skuMappings.pinned, true));
  if (q) {
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(schema.skuMappings.internalSku, like),
        ilike(schema.skuMappings.fulfillerSku, like),
        ilike(schema.skuMappings.productType, like),
        ilike(schema.skuMappings.variant, like),
      )!,
    );
  }

  const rows = await db.select().from(schema.skuMappings).where(and(...conds)).limit(limit);
  const hideProfit = await hasRestriction(session.sub, "hide_profit");

  const variants = rows.map((m) => {
    const { style, color, size } = parseVariant(m.variant, m.productType);
    // Printify: nhà in nằm sau " · " trong fulfillerProduct ("Blueprint · Nhà in") → tách ra làm cột Provider.
    const fp = m.fulfillerProduct ?? "";
    const provider = (m.fulfillerSku?.startsWith("PF-") && fp.includes(" · ")) ? fp.split(" · ").slice(1).join(" · ").trim() : "";
    return {
      id: m.id,
      fulfillerSku: m.fulfillerSku,
      internalSku: m.internalSku,
      unitCost: hideProfit ? 0 : Number(m.baseCost) + Number(m.shipCost),
      style, provider, color, size,
      variant: m.variant ?? "",
    };
  });
  variants.sort((a, b) => a.style.localeCompare(b.style) || a.fulfillerSku.localeCompare(b.fulfillerSku));

  return NextResponse.json({ ok: true, variants, capped: rows.length >= limit });
}
