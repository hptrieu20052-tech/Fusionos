import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUploadTarget } from "@/lib/storage";

export const dynamic = "force-dynamic";

// POST /api/admin/users/contract-upload-url { filename, contentType } → presigned PUT lên R2
// Chỉ admin; nhận file hợp đồng Word/PDF, key: contracts/<ts>-<tên file sạch>
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false }, { status: 403 });
  const b = await req.json().catch(() => null);
  const ct = String(b?.contentType ?? "");
  const OK = [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/pdf",
  ];
  if (!OK.includes(ct)) return NextResponse.json({ ok: false, error: "Chỉ nhận file Word (.doc/.docx) hoặc PDF" }, { status: 400 });
  const clean = String(b?.filename ?? "contract.docx").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `contracts/${Date.now()}-${clean}`;
  const target = await getUploadTarget(key, ct);
  return NextResponse.json({ ok: true, key, storageKey: key, ...target });
}
