import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";

// Khi đơn có tracking (webhook fulfiller trả về / nhập tay / import) → tự chuyển sang "shipped".
// Chỉ nâng từ các trạng thái trước đó; KHÔNG đụng đơn đã shipped/delivered/trash/cancel.
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

// Sau khi đẩy đơn sang nhà in (tạo fulfillment order) → chuyển "created".
export async function markCreatedOnPush(orderId: string) {
  try {
    await db.update(schema.orders).set({ status: "created" })
      .where(and(eq(schema.orders.id, orderId), inArray(schema.orders.status, ["new", "has_issues"] as never)));
  } catch { /* best-effort */ }
}

// Đồng bộ trạng thái đơn theo trạng thái nhà in (chỉ tiến tới, không lùi).
// fulfiller "in_production" → In Production; "shipped" → Shipped; "delivered" → Completed.
export async function syncOrderFromFf(orderId: string, ffStatus: string) {
  const map: Record<string, { target: string; prev: string[] }> = {
    in_production: { target: "in_production", prev: ["new", "created", "has_issues"] },
    shipped: { target: "shipped", prev: ["new", "created", "in_production", "has_issues"] },
    delivered: { target: "delivered", prev: ["new", "created", "in_production", "shipped", "has_issues"] },
  };
  const m = map[ffStatus];
  if (!m) return;
  try {
    await db.update(schema.orders).set({ status: m.target as never })
      .where(and(eq(schema.orders.id, orderId), inArray(schema.orders.status, m.prev as never)));
  } catch { /* best-effort */ }
}
