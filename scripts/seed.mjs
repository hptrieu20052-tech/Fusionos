// Seed dữ liệu mẫu bằng SQL thuần (không cần build TS)
import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/fusion" });
await c.connect();

const u = async (name, email, role, team) =>
  (await c.query(
    `INSERT INTO users (full_name,email,password_hash,role,team,status) VALUES ($1,$2,'dev',$3,$4,'active')
     ON CONFLICT (email) DO UPDATE SET team=EXCLUDED.team RETURNING id`,
    [name, email, role, team]
  )).rows[0].id;

const admin = await u("Tuấn Anh", "admin@fusion.co", "admin", "Ban điều hành");
const tri   = await u("Minh Trí", "tri@fusion.co", "seller", "Seller · TikTok");
const ha    = await u("Thu Hà", "ha@fusion.co", "seller", "Seller · Amazon");
const anh   = await u("Ngọc Ánh", "anh@fusion.co", "designer", "Design");

const st = async (name, mk, seller, method) =>
  (await c.query(
    `INSERT INTO stores (name,marketplace,seller_id,connect_method,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
    [name, mk, seller, method]
  )).rows[0].id;
const st1 = await st("gymwear.us", "tiktok", tri, "api");
const st2 = await st("USPrime01", "amazon", ha, "extension");

const gm = (await c.query(
  `INSERT INTO fulfillers (name,method,api_endpoint,auto_push) VALUES ('Gearment','api','https://api.gearment.com/v2/',true)
   ON CONFLICT (name) DO UPDATE SET method=EXCLUDED.method RETURNING id`
)).rows[0].id;
await c.query(
  `INSERT INTO sku_mappings (internal_sku,product_type,variant,fulfiller_id,fulfiller_sku,fulfiller_product,base_cost,ship_cost)
   VALUES ('TEE-GYM-L-BLK','T-Shirt','L/Black',$1,'G-TEE-5000-L-BK','Gildan 5000',5.80,3.00)
   ON CONFLICT (internal_sku,fulfiller_id) DO NOTHING`, [gm]);

const dz = (await c.query(
  `INSERT INTO designs (title,seller_id,designer_id,platform,points,listed) VALUES ('gym_rat_era_tee',$1,$2,'tiktok',2,true) RETURNING id`,
  [tri, anh]
)).rows[0].id;

const buyers = [["Alicia","Bennett"],["Marcus","Cole"],["Sarah","Miller"],["James","Parker"],["Emma","Wilson"]];
const sts = ["new","new","shipped","shipped","completed"];
for (let i = 0; i < 5; i++) {
  const r = await c.query(
    `INSERT INTO orders (external_id,platform,source,store_id,seller_id,status,platform_status,buyer_first,buyer_last,addr1,city,state,zip,total,platform_fee,ordered_at)
     VALUES ($1,'tiktok','api',$2,$3,$4,'AWAITING_SHIPMENT',$5,$6,$7,'Austin','Texas','78701',$8,2.10,NOW() - ($9 || ' days')::interval)
     ON CONFLICT (platform,external_id) DO NOTHING RETURNING id`,
    [`57746359877059${9000+i}`, st1, tri, sts[i], buyers[i][0], buyers[i][1], `${100+i} Main St`, 24.99 + i*3, i]
  );
  if (r.rows[0]) await c.query(
    `INSERT INTO order_items (order_id,product_title,internal_sku,qty,unit_price,design_id)
     VALUES ($1,'Gym Rat Era Tee, Unisex Heavy Cotton','TEE-GYM-L-BLK',1,24.99,$2)`, [r.rows[0].id, dz]);
}
const r2 = await c.query(
  `INSERT INTO orders (external_id,platform,source,store_id,seller_id,status,buyer_first,buyer_last,addr1,city,state,zip,total,platform_fee,ordered_at)
   VALUES ('114-2200987-661','amazon','extension',$1,$2,'shipped','Sarah','Miller','402 Maple Ave','Columbus','Ohio','43004',19.95,1.85,NOW())
   ON CONFLICT (platform,external_id) DO NOTHING RETURNING id`, [st2, ha]);
if (r2.rows[0]) await c.query(
  `INSERT INTO order_items (order_id,product_title,internal_sku,qty,unit_price)
   VALUES ($1,'Dog Dad Coffee Mug 15oz','MUG-DOG-15',1,19.95)`, [r2.rows[0].id]);

console.log("✅ Seed xong: 4 user · 2 store · 1 fulfiller · 1 mapping · 1 design · 6 đơn");
await c.end();
