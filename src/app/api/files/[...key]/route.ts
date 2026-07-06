// Dev-only: serve file local. Production: CDN → R2, không đi qua đây.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4",
};

export async function GET(_req: NextRequest, { params }: { params: { key: string[] } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const key = params.key.join("/");
  if (key.includes("..")) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const buf = await readFile(key);
    const ext = key.split(".").pop() ?? "";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
}
