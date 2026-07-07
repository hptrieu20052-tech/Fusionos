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
    max: isServerless ? 1 : 10,
    idleTimeoutMillis: isServerless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (!isServerless) globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
