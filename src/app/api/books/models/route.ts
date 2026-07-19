import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { listModels } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";

// GET /api/books/models?type=text|image → danh sách model OpenRouter cho UI chọn theo khâu.
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const type = req.nextUrl.searchParams.get("type") === "image" ? "image" : "text";
  try {
    const models = await listModels(type);
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
