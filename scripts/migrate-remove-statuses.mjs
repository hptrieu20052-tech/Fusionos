// Chạy 1 lần: chuyển đơn cancel / out_of_stock cũ vào trash (workflow mới)
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`UPDATE orders SET status='trash', updated_at=NOW() WHERE status IN ('cancel','out_of_stock') RETURNING id`);
console.log(`Đã chuyển ${r.rowCount} đơn cancel/out_of_stock → trash`);
await c.end();
