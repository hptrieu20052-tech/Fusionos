// Sinh design demo có ẢNH THẬT (SVG → PNG/WebP qua sharp) để xem card đầy đủ.
// Chạy: node --env-file=.env scripts/seed-designs-demo.mjs
import pg from "pg";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const LOCAL_DIR = path.join(process.cwd(), ".uploads");

// Bảng chủ đề POD để tên + màu đa dạng
const THEMES = [
  ["Beach Vacation", "#4a7fa5", "#e8f0f5", "🏖️"],
  ["Mountain Adventure", "#3d6b52", "#e9f2ec", "⛰️"],
  ["Dog Dad", "#8a5a3c", "#f5ede5", "🐕"],
  ["Cat Mom", "#7d5a8c", "#f0eaf3", "🐈"],
  ["Gym Rat Era", "#2a3f5f", "#e8ebf0", "💪"],
  ["Coffee Lover", "#6b4423", "#f2ebe3", "☕"],
  ["Nurse Life", "#3a7d7d", "#e5f2f2", "🩺"],
  ["Teacher Squad", "#a5563d", "#f5e9e5", "📚"],
  ["Fishing Legend", "#3d5a7d", "#e5ebf2", "🎣"],
  ["Garden Therapy", "#5a7d3d", "#ecf2e5", "🌻"],
  ["Camping Crew", "#5a6b3d", "#eef0e5", "🏕️"],
  ["Motorcycle Soul", "#4a4a4a", "#ececec", "🏍️"],
];
const NAMES = ["Sophia", "Mommy", "Daddy", "Patrick", "Emma", "Liam", "Grandma", "Grandpa", "Olivia", "Noah", "Ava", "Mason", "Isla", "Lucas", "Mia"];
const PRODUCTS = ["Tee", "Hoodie", "Mug", "Poster", "Tote", "Sweatshirt", "Ornament", "Blanket"];

function svgArtwork(theme, name, color, bg, emoji) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
    <rect width="1200" height="1200" fill="${bg}"/>
    <circle cx="600" cy="440" r="300" fill="none" stroke="${color}" stroke-width="8" opacity="0.5"/>
    <text x="600" y="300" font-family="Georgia, serif" font-size="64" font-weight="bold" fill="${color}" text-anchor="middle" letter-spacing="4">${theme.toUpperCase()}</text>
    <text x="600" y="480" font-size="180" text-anchor="middle">${emoji}</text>
    <text x="600" y="720" font-family="'Brush Script MT', cursive" font-size="120" fill="${color}" text-anchor="middle" font-style="italic">${name}</text>
    <text x="600" y="820" font-family="Georgia, serif" font-size="40" fill="${color}" text-anchor="middle" opacity="0.7">Est. 2026 · FUSION</text>
    <rect x="200" y="900" width="800" height="3" fill="${color}" opacity="0.4"/>
  </svg>`);
}

async function writeLocal(key, buf) {
  const full = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
}

// lấy 3 user theo role để gán
const sellers = (await c.query("SELECT id, full_name FROM users WHERE role='seller' ORDER BY full_name")).rows;
const designers = (await c.query("SELECT id, full_name FROM users WHERE role='designer' ORDER BY full_name")).rows;
const creators = (await c.query("SELECT id, full_name FROM users WHERE role='content' ORDER BY full_name")).rows;
const stores = (await c.query("SELECT id FROM stores ORDER BY name")).rows;
const platforms = ["tiktok", "amazon", "etsy"];

const COUNT = 40;
let made = 0;
for (let i = 0; i < COUNT; i++) {
  const [theme, color, bg, emoji] = THEMES[i % THEMES.length];
  const name = NAMES[i % NAMES.length];
  const product = PRODUCTS[i % PRODUCTS.length];
  const title = `${theme} ${product} - ${name}`;

  const seller = sellers[i % sellers.length];
  const designer = designers[i % designers.length];
  const creator = creators.length ? creators[i % creators.length] : null;
  const store = stores.length ? stores[i % stores.length] : null;
  const platform = platforms[i % platforms.length];
  const points = [1, 1, 2, 2, 3][i % 5];
  const createdDaysAgo = i % 30;

  // Tạo design
  const dRes = await c.query(
    `INSERT INTO designs (title, seller_id, designer_id, creator_id, store_id, platform, points, listed, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() - ($9 || ' days')::interval) RETURNING id, sku_code`,
    [title, seller.id, designer.id, creator?.id ?? null, store?.id ?? null, platform, points, i % 3 !== 0, createdDaysAgo]
  );
  const design = dRes.rows[0];

  // Sinh ảnh: original PNG + preview 1200 webp + thumb 300 webp
  const svg = svgArtwork(theme, name, color, bg, emoji);
  const pngBuf = await sharp(svg).png().toBuffer();
  const previewBuf = await sharp(svg).resize(1200, 1200, { fit: "inside" }).webp({ quality: 82 }).toBuffer();
  const thumbBuf = await sharp(svg).resize(300, 300, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  const meta = await sharp(pngBuf).metadata();
  const sha = crypto.createHash("sha256").update(pngBuf).digest("hex");

  const baseKey = `designs/${design.id}/design_front-${Date.now()}-${i}`;
  const storageKey = `${baseKey}.png`;
  const previewKey = `${baseKey}.preview.webp`;
  const thumbKey = `${baseKey}.thumb.webp`;
  await writeLocal(storageKey, pngBuf);
  await writeLocal(previewKey, previewBuf);
  await writeLocal(thumbKey, thumbBuf);

  await c.query(
    `INSERT INTO design_files (design_id, kind, storage_key, thumb_key, preview_key, sha256, size_bytes, width, height, processing_status)
     VALUES ($1,'design_front',$2,$3,$4,$5,$6,$7,$8,'ready')`,
    [design.id, storageKey, thumbKey, previewKey, sha, pngBuf.length, meta.width, meta.height]
  );

  // ~40% có thêm 1 mockup
  if (i % 5 < 2) {
    const mockKey = `designs/${design.id}/mockup-${Date.now()}-${i}`;
    await writeLocal(`${mockKey}.png`, pngBuf);
    await writeLocal(`${mockKey}.thumb.webp`, thumbBuf);
    await writeLocal(`${mockKey}.preview.webp`, previewBuf);
    await c.query(
      `INSERT INTO design_files (design_id, kind, storage_key, thumb_key, preview_key, sha256, size_bytes, width, height, processing_status)
       VALUES ($1,'mockup',$2,$3,$4,$5,$6,$7,$8,'ready')`,
      [design.id, `${mockKey}.png`, `${mockKey}.thumb.webp`, `${mockKey}.preview.webp`, sha + "m", pngBuf.length, meta.width, meta.height]
    );
  }
  made++;
}

console.log(`✅ Đã tạo ${made} design demo có ảnh thật (thumb + preview + original).`);
await c.end();
