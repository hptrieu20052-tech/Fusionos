import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";

// Khi đơn có tracking (webhook fulfiller trả về / nhập tay / import) → tự chuyển sang "shipped".
// Chỉ nâng từ các trạng thái trước đó; KHÔNG đụng đơn đã shipped/completed/trash/cancel.
export async function markShippedOnTracking(orderId: string) {
  try {
    await db.update(schema.orders)
      .set({ status: "shipped" })
      .where(and(
        eq(schema.orders.id, orderId),
        inArray(schema.orders.status, ["new", "created", "in_production", "has_issues"] as never),
      ));
  } catch {
    // best-effort: không làm hỏng luồng webhook/nhập tracking nếu lỗi
  }
}
