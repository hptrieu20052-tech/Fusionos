import { NextRequest, NextResponse } from "next/server";
import { readFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/extension/download — zip bản mới nhất: R2 (admin publish) → fallback zip bundled trong repo
export async function GET(req: NextRequest) {
  try {
    const buf = await readFile("extensions/fusion-order-sync.zip");
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="fusion-order-sync.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.redirect(new URL("/extension/fusion-order-sync.zip", req.nextUrl.origin));
  }
}
