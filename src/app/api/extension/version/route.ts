import { NextResponse } from "next/server";
import { readFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Phiên bản extension đóng gói sẵn trong repo — fallback khi admin chưa publish bản nào lên R2
const BUNDLED = { version: "1.1.3", url: "/api/extension/download", notes: "bundled" };

// GET /api/extension/version — extension check update + landing page đọc.
// Ưu tiên bản admin publish trên R2 (extensions/version.json), fallback bản bundled.
export async function GET() {
  try {
    const buf = await readFile("extensions/version.json");
    const j = JSON.parse(buf.toString("utf8"));
    return NextResponse.json({ ...BUNDLED, ...j, url: "/api/extension/download" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(BUNDLED, { headers: { "Cache-Control": "no-store" } });
  }
}
