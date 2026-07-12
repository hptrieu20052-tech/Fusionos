import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * GET /api/fulfillers/catalog-sample?fulfillerId=xxx — DEBUG (admin):
 * trả raw JSON trang đầu catalog của nhà fulfill (ONOS /products · Wembroidery /public/catalog ·
 * ONOS detail nếu thêm &productId=) để soi cấu trúc khi parser chưa khớp. Cắt 8000 ký tự.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const fulfillerId = req.nextUrl.searchParams.get("fulfillerId");
  const productId = req.nextUrl.searchParams.get("productId");
  if (!fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; accessToken?: string; apiToken?: string };
  const apiKey = c.apiKey || c.accessToken || c.apiToken;
  if (!apiKey) return NextResponse.json({ ok: false, error: "API Key not configured" }, { status: 400 });

  const name = ff.name.toLowerCase();
  try {
    let raw: unknown;
    if (name.includes("onos")) {
      if (productId) {
        const { getOnosProductVariants } = await import("@/lib/onos");
        const r = await getOnosProductVariants({ apiKey, endpoint: ff.apiEndpoint }, productId);
        raw = { parsedVariants: r.variants.slice(0, 5), sample: r.sample };
      } else {
        const { listOnosProducts } = await import("@/lib/onos");
        const r = await listOnosProducts({ apiKey, endpoint: ff.apiEndpoint }, 1, 5);
        raw = { parsedVariants: r.variants.slice(0, 5), sample: r.sample };
      }
    } else if (name.includes("wembroidery")) {
      const { getWembroideryCatalog } = await import("@/lib/wembroidery");
      const r = await getWembroideryCatalog({ apiKey, endpoint: ff.apiEndpoint });
      raw = { parsedRows: r.rows.slice(0, 5), totalParsed: r.rows.length, sample: r.sample };
    } else {
      return NextResponse.json({ ok: false, error: "debug only supports ONOS / Wembroidery" }, { status: 400 });
    }
    const text = JSON.stringify(raw, null, 1);
    return NextResponse.json({ ok: true, fulfiller: ff.name, sample: text.length > 8000 ? text.slice(0, 8000) + "…(truncated)" : JSON.parse(text) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
