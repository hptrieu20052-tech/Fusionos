import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listPromptsForAdmin, savePrompt, resetPrompt } from "@/lib/ai/prompt-store";

export const dynamic = "force-dynamic";

// Manager Prompts — CHỈ admin. Xem/sửa/khôi phục prompt AI (ghi đè DB, không cần deploy).
//   GET   → danh sách đầy đủ (meta + default + override + effective)
//   PATCH { id, value }        → lưu ghi đè (value == default hoặc rỗng ⇒ tự reset)
//   PATCH { id, reset:true }   → khôi phục default

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const prompts = await listPromptsForAdmin();
  return NextResponse.json({ ok: true, prompts });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = typeof b?.id === "string" ? b.id : "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    if (b?.reset === true) {
      await resetPrompt(id);
    } else {
      if (typeof b?.value !== "string") return NextResponse.json({ ok: false, error: "value required" }, { status: 400 });
      if (b.value.length > 60000) return NextResponse.json({ ok: false, error: "prompt quá dài (>60k ký tự)" }, { status: 400 });
      await savePrompt(id, b.value, session.sub);
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 400 });
  }
  const prompts = await listPromptsForAdmin();
  return NextResponse.json({ ok: true, prompts });
}
