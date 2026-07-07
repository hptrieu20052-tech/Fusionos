import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { useR2, writeFile, readFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/designs/diag — CHỈ admin. Chẩn đoán vì sao ảnh design không hiện.
// KHÔNG lộ secret: chỉ báo biến môi trường CÓ hay KHÔNG, và URL public (không phải bí mật).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });
  if ((await levelOf(session, "designs")) < 2)
    return NextResponse.json({ ok: false, error: "Cần quyền admin designs" }, { status: 403 });

  const env = {
    R2_ACCOUNT_ID: !!process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: !!process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: !!process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET || null,
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || process.env.R2_PUBLIC_BASE || null,
  };

  // 1) Test ghi + đọc lại một file nhỏ vào kho lưu trữ đang dùng
  const testKey = `diag/selftest-${Date.now()}.txt`;
  const testBody = Buffer.from("fusion-os storage self-test");
  const write: { ok: boolean; error?: string } = { ok: false };
  const read: { ok: boolean; bytes?: number; matches?: boolean; error?: string } = { ok: false };
  try {
    await writeFile(testKey, testBody, "text/plain");
    write.ok = true;
    try {
      const got = await readFile(testKey);
      read.ok = true;
      read.bytes = got.length;
      read.matches = got.toString() === testBody.toString();
    } catch (e) {
      read.error = String(e).slice(0, 300);
    }
  } catch (e) {
    write.error = String(e).slice(0, 300);
  }

  // 2) Lấy file design mới nhất, kiểm tra file THẬT có đọc được từ kho không
  const [latest] = await db.select().from(schema.designFiles).orderBy(desc(schema.designFiles.createdAt)).limit(1);
  let latestFile: Record<string, unknown> | null = null;
  if (latest) {
    const realRead: { ok: boolean; bytes?: number; error?: string } = { ok: false };
    try {
      const buf = await readFile(latest.storageKey);
      realRead.ok = true;
      realRead.bytes = buf.length;
    } catch (e) {
      realRead.error = String(e).slice(0, 300);
    }
    latestFile = {
      designId: latest.designId,
      kind: latest.kind,
      processingStatus: latest.processingStatus,
      storageKey: latest.storageKey,
      thumbKey: latest.thumbKey,
      previewKey: latest.previewKey,
      urls: {
        original: fileUrl(latest.storageKey),
        thumb: fileUrl(latest.thumbKey),
        preview: fileUrl(latest.previewKey),
      },
      // Kết quả đọc file gốc trực tiếp từ R2/local — quan trọng nhất:
      realFileReadableFromStorage: realRead,
    };
  }

  // 3) Kết luận tự động
  const notes: string[] = [];
  if (!useR2) notes.push("useR2 = FALSE → đang dùng ổ đĩa local. Trên Vercel ổ đĩa là tạm/không ghi được → ảnh mất. Cần set đủ 4 biến R2_* trên Vercel.");
  if (useR2 && !env.R2_PUBLIC_URL) notes.push("R2 bật nhưng CHƯA có R2_PUBLIC_URL → ảnh phục vụ qua /api/files (chậm, cần đăng nhập). Nên set R2_PUBLIC_URL trỏ tới domain public của bucket.");
  if (write.ok && !read.ok) notes.push("Ghi được nhưng ĐỌC lại lỗi → sai quyền đọc hoặc bucket/endpoint sai.");
  if (!write.ok) notes.push("KHÔNG ghi được vào kho → sai credential R2 hoặc bucket không tồn tại. Xem write.error.");
  if (latestFile && !(latestFile.realFileReadableFromStorage as { ok: boolean }).ok)
    notes.push("File design mới nhất KHÔNG đọc được từ kho → lúc upload file không thực sự bay lên R2 (thường do CORS của bucket chặn PUT từ trình duyệt, hoặc presigned URL sai).");

  return NextResponse.json({
    ok: true,
    useR2,
    env,
    selfTest: { key: testKey, write, read },
    latestFile,
    notes,
    hint: "Gửi toàn bộ JSON này cho trợ lý để chẩn đoán.",
  });
}
