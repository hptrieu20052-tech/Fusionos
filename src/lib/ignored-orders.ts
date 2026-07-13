import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

/**
 * Blocklist đơn hệ thống CŨ.
 *
 * Trong lúc chuyển hệ thống, đơn đã xử lý bên hệ cũ mà lọt vào FUSION sẽ bị đẩy sang nhà in
 * lần thứ hai → in đúp, mất tiền. Cutoff theo ngày (INGEST_SINCE) không đủ: đơn đặt sát mốc
 * vẫn có thể lọt cả hai bên. Chặn theo đúng Order ID thì kín.
 *
 * Trả về Set các external_id CẦN BỎ QUA, chỉ hỏi DB đúng những ID đang xét (không load cả bảng).
 * Lỗi DB (bảng chưa migrate) → trả Set rỗng, không chặn gì, để ingest không chết.
 */
export async function ignoredSet(externalIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(externalIds.map((x) => String(x ?? "").trim()).filter(Boolean)));
  if (!ids.length) return new Set();
  try {
    const rows = (await db.execute(sql`
      SELECT external_id FROM ignored_orders
      WHERE external_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})
    `)).rows as { external_id: string }[];
    return new Set(rows.map((r) => r.external_id));
  } catch {
    return new Set(); // bảng chưa tồn tại → không chặn
  }
}

/**
 * Tách Order ID từ text dán vào / file upload.
 * Chấp nhận mọi kiểu: mỗi dòng 1 ID, CSV nhiều cột, phân cách bằng dấu phẩy/tab/space.
 * Giữ token trông giống Order ID (>= 6 ký tự, chỉ chữ-số-gạch), bỏ header và cột rác.
 */
export function parseOrderIds(raw: string): string[] {
  const tokens = String(raw ?? "")
    .split(/[\s,;"']+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = new Set<string>();
  for (const tk of tokens) {
    if (tk.length < 6) continue;                 // quá ngắn → không phải order id
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(tk)) continue; // có ký tự lạ → bỏ
    if (/^[A-Za-z_-]+$/.test(tk)) continue;      // toàn chữ → là tên cột (header), bỏ
    out.add(tk);
  }
  return Array.from(out);
}
