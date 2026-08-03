import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { listModels } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";

// GET /api/books/models?type=text|image|vision → danh sách model OpenRouter cho UI chọn theo khâu.
// vision = model ĐỌC được ảnh (dùng cho alt text ảnh trong Manage Products).
export async function GET(req: NextRequest) {
  const s = await getSession();
  // Cho phép mọi module AI Agent + Manage Products Etsy (AI Optimize) dùng chung danh sách model.
  const allowed = (await can(s, "bookStudio")) || (await can(s, "genImage")) || (await can(s, "genVideo")) || (await can(s, "products"));
  if (!allowed) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const q = req.nextUrl.searchParams.get("type");
  const type: "text" | "image" | "vision" = q === "image" ? "image" : q === "vision" ? "vision" : "text";
  try {
    const models = await listModels(type);
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 });
  }
}
