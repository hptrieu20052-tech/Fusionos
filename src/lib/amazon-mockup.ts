/**
 * Amazon main-image processor (v307).
 *
 * Nhận ảnh mockup sách (đã có sẵn từ Book Studio AI — nền gần trắng) và chuẩn hóa thành
 * ảnh MAIN đúng chuẩn Amazon:
 *   • Nền TRẮNG TUYỆT ĐỐI (255,255,255) — flood-fill từ 4 biên các pixel gần-trắng (ăn luôn
 *     bóng nhạt), giữ nguyên thân sách (kể cả vùng trắng bên trong không dính biên).
 *   • Crop sát thân sách → pad vuông có lề → thêm bóng đổ mềm cho cảm giác 3D.
 *   • Resize 1600×1600, xuất JPEG (nhẹ → Amazon crawler không bị timeout, hết lỗi 20000).
 *
 * Chạy hoàn toàn server-side bằng sharp (đã có trong deps). Không phụ thuộc dịch vụ ngoài.
 */
import sharp from "sharp";

export type PurifyOpts = { size?: number; near?: number; margin?: number; shadow?: boolean; quality?: number };

export async function purifyMainImage(input: Buffer, opts: PurifyOpts = {}): Promise<Buffer> {
  const size = opts.size ?? 1600;
  const near = opts.near ?? 232;         // ngưỡng "gần trắng" — ăn cả bóng nhạt, dừng ở mép sách sẫm
  const margin = opts.margin ?? 0.06;    // lề trắng quanh sách
  const wantShadow = opts.shadow ?? true;
  const quality = opts.quality ?? 90;

  const base = sharp(input).ensureAlpha().flatten({ background: "#ffffff" });
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;

  const isNear = (i: number) => data[i] >= near && data[i + 1] >= near && data[i + 2] >= near;
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (bg[p]) return;
    if (!isNear(p * ch)) return;
    bg[p] = 1; stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop()!; const x = p % w, y = (p / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * ch;
    if (bg[p]) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
    else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
  const cw = maxX - minX + 1, chh = maxY - minY + 1;

  const whitenedFull = await sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
  const cropped = await sharp(whitenedFull).extract({ left: minX, top: minY, width: cw, height: chh }).toBuffer();

  const side = Math.max(cw, chh);
  const pad = Math.round(side * margin);
  const canvas = side + 2 * pad;
  const bL = Math.round((canvas - cw) / 2), bT = Math.round((canvas - chh) / 2);

  const layers: { input: Buffer; left: number; top: number }[] = [];
  if (wantShadow) {
    const sw = Math.round(cw * 0.86), shH = Math.max(10, Math.round(chh * 0.05));
    const shadow = await sharp({ create: { width: sw, height: shH, channels: 4, background: "#00000000" } })
      .composite([{ input: Buffer.from(`<svg width="${sw}" height="${shH}"><ellipse cx="${sw / 2}" cy="${shH / 2}" rx="${(sw / 2) * 0.9}" ry="${(shH / 2) * 0.75}" fill="rgba(55,55,65,0.30)"/></svg>`), left: 0, top: 0 }])
      .blur(14).png().toBuffer();
    layers.push({ input: shadow, left: bL + Math.round(cw * 0.07), top: bT + chh - Math.round(shH * 0.35) });
  }
  layers.push({ input: cropped, left: bL, top: bT });

  // Ghép trên canvas vuông → xuất buffer, RỒI mới resize (resize ngay sau composite trong cùng
  // pipeline sharp không scale — phải tách 2 bước).
  const composed = await sharp({ create: { width: canvas, height: canvas, channels: 3, background: "#ffffff" } })
    .composite(layers).png().toBuffer();
  return sharp(composed).resize(size, size, { fit: "fill" }).jpeg({ quality, progressive: true }).toBuffer();
}
