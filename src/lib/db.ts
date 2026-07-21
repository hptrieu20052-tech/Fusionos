import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

// Serverless (Vercel): mỗi instance chỉ giữ ít connection để không cạn pool Supabase.
// Local: giữ nhiều hơn cho tiện. Nên dùng Supabase Transaction Pooler (port 6543) trên production.
const isServerless = !!process.env.VERCEL;
const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Cần >1 để các truy vấn Promise.all trong 1 request chạy SONG SONG (max:1 ép chúng xếp hàng, mất tác dụng).
    // An toàn khi DATABASE_URL trỏ Supabase Transaction Pooler (port 6543).
    max: isServerless ? 4 : 10,
    // Fluid Compute giữ instance sống lâu → giữ connection 60s (trước là 10s) + keepAlive
    // để click sau quãng nghỉ ngắn KHÔNG phải bắt tay TCP/TLS/auth lại với Supabase (~0.5–1s mỗi lần).
    idleTimeoutMillis: 60_000,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
  });

if (!isServerless) globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
