import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { saveEtsyCfg } from "@/lib/etsy";

export const dynamic = "force-dynamic";

// Lưu keystring + shared secret của app Etsy riêng cho store này (secret được mã hoá).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({})) as { storeId?: string; keystring?: string; sharedSecret?: string };
  if (!b.storeId || !b.keystring || !b.sharedSecret) return NextResponse.json({ ok: false, error: "missing keystring / shared secret" }, { status: 400 });

  await saveEtsyCfg(b.storeId, { keystring: b.keystring.trim(), sharedSecret: b.sharedSecret.trim() });
  const callbackUrl = `${req.nextUrl.origin}/api/etsy/oauth/callback`;
  return NextResponse.json({ ok: true, callbackUrl });
}
