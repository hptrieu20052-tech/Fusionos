// Seed / bổ sung các nhà fulfill (idempotent — không tạo trùng, không đụng cái đã có).
// Chạy: node --env-file=.env scripts/seed-fulfillers.mjs
import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const FULFILLERS = [
  "Printify",
  "Merchize",
  "Printway",
  "Wembroidery",
  "Flashship",
  "Onospod",
  "Compassup",
  "Gearment",
];

for (const name of FULFILLERS) {
  await c.query(
    `INSERT INTO fulfillers (name, method, status)
     VALUES ($1, 'api', 'connected')
     ON CONFLICT (name) DO NOTHING`,
    [name]
  );
}

const { rows } = await c.query(`SELECT name, method, status FROM fulfillers ORDER BY name`);
console.log("Nhà fulfill hiện có:");
for (const r of rows) console.log(`  · ${r.name} (${r.method} · ${r.status})`);

await c.end();
console.log("✓ Xong. Các nhà fulfill đã sẵn sàng, có thể vào Settings điền API endpoint + credentials khi có doc.");
