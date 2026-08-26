/**
 * Amazon main-image processor (v354).
 *
 * Nhận ảnh mockup sách (đã có sẵn từ Book Studio AI — nền gần trắng / kem / xám nhạt) và
 * chuẩn hóa thành ảnh MAIN đúng chuẩn Amazon:
 *   • Lấy mẫu màu nền từ 4 GÓC → flood-fill từ 4 biên ăn cả nền kem/xám-nhạt/gradient
 *     (không chỉ trắng tinh), GIỮ NGUYÊN vùng trắng bên trong sách (không dính biên).
 *   • Khử viền xám (defringe) 1 vòng quanh mép sách → hết quầng, không gặm vào bìa.
 *   • Chỉnh sáng/màu/nét nhẹ cho sách "bật" lên (nền trắng vẫn 255, không bị ảnh hưởng).
 *   • Crop sát thân sách → pad vuông có lề → bóng đổ mềm 3D.
 *   • Resize 2000×2000, xuất JPEG mozjpeg (nhẹ → Amazon crawler không timeout, hết lỗi 20000).
 *
 * Chạy hoàn toàn server-side bằng sharp (đã có trong deps). Không phụ thuộc dịch vụ ngoài.
 */
import sharp from "sharp";

export type PurifyOpts = { size?: number; near?: number; tol?: number; margin?: number; shadow?: boolean; enhance?: boolean; quality?: number };

export async function purifyMainImage(input: Buffer, opts: PurifyOpts = {}): Promise<Buffer> {
  const size = opts.size ?? 2000;
  const near = opts.near ?? 230;         // ngưỡng "gần trắng" — ăn cả bóng nhạt, dừng ở mép sách sẫm
  const tol = opts.tol ?? 46;            // dung sai màu quanh mẫu nền 4 góc (bắt nền kem/xám nhạt)
  const margin = opts.margin ?? 0.06;    // lề trắng quanh sách
  const wantShadow = opts.shadow ?? true;
  const wantEnhance = opts.enhance ?? true;
  const quality = opts.quality ?? 88;

  // Cap độ phân giải xử lý ≤2000 (flood-fill nhanh + mượt nhiễu). Không phóng to ảnh nhỏ ở bước này.
  const base = sharp(input).ensureAlpha().flatten({ background: "#ffffff" })
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true });
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;

  // ── Lấy mẫu 4 góc → màu nền tham chiếu (bắt nền kem/xám-nhạt/gradient, không chỉ trắng tinh).
  const sampleCorner = (x0: number, y0: number): [number, number, number] => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.max(0, y0); y < y0 + 10 && y < h; y++)
      for (let x = Math.max(0, x0); x < x0 + 10 && x < w; x++) {
        const i = (y * w + x) * ch; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    return n ? [r / n, g / n, b / n] : [255, 255, 255];
  };
  const corners: [number, number, number][] = [
    sampleCorner(0, 0), sampleCorner(w - 10, 0), sampleCorner(0, h - 10), sampleCorner(w - 10, h - 10),
  ];
  // Chỉ dùng suy luận theo-góc khi nền thực sự SÁNG (tránh ăn nhầm khi ảnh nền tối/lifestyle).
  const bgIsLight = corners.every((c) => c[0] >= 222 && c[1] >= 222 && c[2] >= 222);
  const tol2 = tol * tol;

  const isNear = (i: number) => data[i] >= near && data[i + 1] >= near && data[i + 2] >= near;
  const nearCorner = (i: number) => {
    for (const c of corners) {
      const dr = data[i] - c[0], dg = data[i + 1] - c[1], db = data[i + 2] - c[2];
      if (dr * dr + dg * dg + db * db <= tol2) return true;
    }
    return false;
  };
  const isBg = (i: number) => isNear(i) || (bgIsLight && nearCorner(i));

  // ── Flood-fill từ 4 biên (chỉ ăn nền NỐI với mép → giữ nguyên vùng trắng BÊN TRONG sách).
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (bg[p]) return;
    if (!isBg(p * ch)) return;
    bg[p] = 1; stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop()!; const x = p % w, y = (p / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // ── Khử viền xám (defringe): pixel foreground sát mép nền mà còn RẤT sáng → blend về trắng
  //    theo độ sáng (càng sáng kéo càng mạnh) → hết quầng xám mà không gặm vào bìa sách.
  const soft = near - 10;
  const fringe: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (bg[p]) continue;
    const i = p * ch;
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    if (mn < soft) continue; // không đủ sáng → chắc chắn là sách, bỏ qua
    if ((x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w])) fringe.push(p);
  }
  for (const p of fringe) {
    const i = p * ch;
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    const t = Math.min(1, (mn - soft) / (255 - soft));
    data[i] = Math.round(data[i] + (255 - data[i]) * t);
    data[i + 1] = Math.round(data[i + 1] + (255 - data[i + 1]) * t);
    data[i + 2] = Math.round(data[i + 2] + (255 - data[i + 2]) * t);
  }

  // ── Đặt nền = trắng tuyệt đối + tính bounding box thân sách.
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * ch;
    if (bg[p]) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
    else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
  const cw = maxX - minX + 1, chh = maxY - minY + 1;

  const whitenedFull = await sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toBuffer();
  let cropped = await sharp(whitenedFull).extract({ left: minX, top: minY, width: cw, height: chh }).toBuffer();

  // ── Chỉnh sáng/màu/nét nhẹ cho sách "bật" lên. Nền trắng (255) bị clip lại 255 nên vẫn tuyệt đối trắng.
  if (wantEnhance) {
    cropped = await sharp(cropped)
      .modulate({ brightness: 1.04, saturation: 1.06 })
      .linear(1.04, -4)
      .sharpen({ sigma: 0.6 })
      .png().toBuffer();
  }

  const side = Math.max(cw, chh);
  const pad = Math.round(side * margin);
  const canvas = side + 2 * pad;
  const bL = Math.round((canvas - cw) / 2), bT = Math.round((canvas - chh) / 2);

  const layers: { input: Buffer; left: number; top: number }[] = [];
  if (wantShadow) {
    const sw = Math.round(cw * 0.86), shH = Math.max(10, Math.round(chh * 0.05));
    const shadow = await sharp({ create: { width: sw, height: shH, channels: 4, background: "#00000000" } })
      .composite([{ input: Buffer.from(`<svg width="${sw}" height="${shH}"><ellipse cx="${sw / 2}" cy="${shH / 2}" rx="${(sw / 2) * 0.9}" ry="${(shH / 2) * 0.75}" fill="rgba(55,55,65,0.28)"/></svg>`), left: 0, top: 0 }])
      .blur(14).png().toBuffer();
    layers.push({ input: shadow, left: bL + Math.round(cw * 0.07), top: bT + chh - Math.round(shH * 0.35) });
  }
  layers.push({ input: cropped, left: bL, top: bT });

  // Ghép trên canvas vuông → xuất buffer, RỒI mới resize (resize ngay sau composite trong cùng
  // pipeline sharp không scale — phải tách 2 bước).
  const composed = await sharp({ create: { width: canvas, height: canvas, channels: 3, background: "#ffffff" } })
    .composite(layers).png().toBuffer();
  return sharp(composed).resize(size, size, { fit: "fill" }).jpeg({ quality, mozjpeg: true, progressive: true }).toBuffer();
}
