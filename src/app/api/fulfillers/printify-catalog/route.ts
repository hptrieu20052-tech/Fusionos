import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listBlueprints, listProviders, listVariants } from "@/lib/printify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET ?fulfillerId=..&level=blueprints
 *     ?fulfillerId=..&level=providers&blueprint=12
 *     ?fulfillerId=..&level=variants&blueprint=12&provider=3
 * Proxy catalog Printify (cần token scope catalog.read).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const fulfillerId = sp.get("fulfillerId");
  const level = sp.get("level") ?? "blueprints";
  if (!fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; apiToken?: string };
  const token = c.apiKey || c.apiToken;
  if (!token) return NextResponse.json({ ok: false, error: "Printify token not configured" }, { status: 400 });

  try {
    if (level === "blueprints") {
      const bps = await listBlueprints(token);
      return NextResponse.json({ ok: true, blueprints: bps.map((b) => ({ id: b.id, title: b.title, brand: b.brand, model: b.model })) });
    }
    if (level === "providers") {
      const bp = sp.get("blueprint");
      if (!bp) return NextResponse.json({ ok: false, error: "missing blueprint" }, { status: 400 });
      const ps = await listProviders(token, bp);
      return NextResponse.json({ ok: true, providers: ps });
    }
    if (level === "variants") {
      const bp = sp.get("blueprint"); const pv = sp.get("provider");
      if (!bp || !pv) return NextResponse.json({ ok: false, error: "missing blueprint/provider" }, { status: 400 });
      const vs = await listVariants(token, bp, pv);
      return NextResponse.json({ ok: true, variants: vs.map((v) => ({ id: v.id, title: v.title })) });
    }
    return NextResponse.json({ ok: false, error: "invalid level" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
