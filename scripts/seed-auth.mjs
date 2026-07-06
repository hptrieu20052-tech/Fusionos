// Seed v2: hash mật khẩu thật + ma trận quyền + restrictions + thêm user content
import pg from "pg";
import bcrypt from "bcryptjs";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/fusion" });
await c.connect();

const hash = await bcrypt.hash("fusion123", 10);
await c.query(`UPDATE users SET password_hash=$1`, [hash]); // user cũ từ seed v1 → mật khẩu fusion123

// Thêm 1 content creator để test bị chặn module orders
await c.query(
  `INSERT INTO users (full_name,email,password_hash,role,team,status)
   VALUES ('Phương Linh','linh@fusion.co',$1,'content','TikTok Media','active')
   ON CONFLICT (email) DO UPDATE SET password_hash=$1`, [hash]);

// Ma trận quyền mặc định (admin không cần seed — code luôn coi admin = 2)
const M = { dashboard:0, orders:1, fulfillment:2, designs:3, finance:4, hr:5, stores:6, settings:7 };
const MATRIX = {
  seller:   { dashboard:1, orders:2, fulfillment:1, designs:2, finance:0, hr:0, stores:1, settings:0 },
  designer: { dashboard:1, orders:1, fulfillment:0, designs:2, finance:0, hr:0, stores:0, settings:0 },
  support:  { dashboard:1, orders:2, fulfillment:2, designs:1, finance:0, hr:0, stores:1, settings:0 },
  content:  { dashboard:1, orders:0, fulfillment:0, designs:1, finance:0, hr:0, stores:0, settings:0 },
  hiring:   { dashboard:1, orders:0, fulfillment:0, designs:0, finance:0, hr:2, stores:0, settings:0 },
};
for (const [role, mods] of Object.entries(MATRIX)) {
  for (const [mod, lv] of Object.entries(mods)) {
    await c.query(
      `INSERT INTO role_permissions (role,module,level) VALUES ($1,$2,$3)
       ON CONFLICT (role,module) DO UPDATE SET level=$3`, [role, mod, lv]);
  }
}

// Restrictions: seller chỉ xem đơn của mình + ẩn lợi nhuận
const sellers = (await c.query(`SELECT id FROM users WHERE role='seller'`)).rows;
for (const s of sellers) {
  await c.query(
    `INSERT INTO user_restrictions (user_id,restriction_key,enabled) VALUES ($1,'own_orders_only',true),($1,'hide_profit',true)
     ON CONFLICT (user_id,restriction_key) DO NOTHING`, [s.id]);
}

console.log("✅ Seed auth xong: mật khẩu tất cả = fusion123 · ma trận quyền 5 role × 8 module · seller bật own_orders_only");
await c.end();
