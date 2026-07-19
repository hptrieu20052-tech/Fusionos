// HỒ SƠ SẢN PHẨM IN cho Book Studio.
// Mỗi sản phẩm cố định: khổ trang (px), khổ cover (px), số trang, và cách NỐI TRANG (spread) khi gen.
// Thêm sản phẩm mới = thêm 1 phần tử vào BOOK_PRODUCTS.

export type BookProduct = {
  key: string;
  name: string;
  pageCount: number;   // số trang ruột
  pageW: number;       // px mỗi trang ruột
  pageH: number;
  coverW: number;      // px cover (back + spine + front)
  coverH: number;
};

export const BOOK_PRODUCTS: BookProduct[] = [
  {
    key: "hardcover_photo_book_8x8",
    name: "Hardcover Photo Book (8×8 · 24 pages)",
    pageCount: 24,
    pageW: 2400, pageH: 2400,     // mỗi trang 2400×2400 (vuông)
    coverW: 5370, coverH: 2850,   // cover 5370×2850
  },
  {
    key: "hardcover_photo_book_11x8_5",
    name: "Hardcover Photo Book (11×8.5 · 24 pages)",
    pageCount: 24,
    pageW: 3450, pageH: 2550,     // mỗi trang 3450×2550 (ngang, ~23:17)
    coverW: 7470, coverH: 3000,   // cover 7470×3000 (~2.49:1)
  },
];

export function getBookProduct(key?: string | null): BookProduct {
  return BOOK_PRODUCTS.find((p) => p.key === key) ?? BOOK_PRODUCTS[0];
}

// KHỐI GEN: cover (rộng) + trang đơn (trang 1, trang cuối) + spread NỐI 2 trang cho các cặp giữa.
// Spread vẽ 1 ảnh liền (2 trang cạnh nhau, nghệ thuật nối qua gáy) rồi CẮT ĐÔI thành 2 file trang khi xuất.
export type GenBlock =
  | { type: "cover"; w: number; h: number }
  | { type: "single"; page: number; w: number; h: number }
  | { type: "spread"; pages: [number, number]; w: number; h: number };

// COVER là 1 tấm wraparound LIỀN (như spread): vẽ 1 ảnh coverW×coverH nối liền,
// NỬA PHẢI = mặt trước (tiêu đề + nhân vật), NỬA TRÁI = mặt sau (cảnh nối tiếp, không chữ),
// rồi CẮT ĐÔI → cover_front (pageNo 0) + cover_back (pageNo -1).
export function coverPanelW(p: BookProduct): number { return Math.round(p.coverW / 2); }

export function genBlocks(p: BookProduct): GenBlock[] {
  const out: GenBlock[] = [{ type: "cover", w: p.coverW, h: p.coverH }];
  out.push({ type: "single", page: 1, w: p.pageW, h: p.pageH });
  // Cặp nối: (2,3) (4,5) … (pageCount-2, pageCount-1)
  for (let i = 2; i + 1 <= p.pageCount - 1; i += 2) {
    out.push({ type: "spread", pages: [i, i + 1], w: p.pageW * 2, h: p.pageH });
  }
  out.push({ type: "single", page: p.pageCount, w: p.pageW, h: p.pageH });
  return out;
}

// Tìm khối chứa 1 trang. pageNo 0 (front) & -1 (back) đều thuộc khối COVER (vẽ 1 lần, cắt đôi).
export function blockForPage(p: BookProduct, pageNo: number): GenBlock | null {
  if (pageNo === 0 || pageNo === -1) return { type: "cover", w: p.coverW, h: p.coverH };
  for (const blk of genBlocks(p)) {
    if (blk.type === "single" && blk.page === pageNo) return blk;
    if (blk.type === "spread" && (blk.pages[0] === pageNo || blk.pages[1] === pageNo)) return blk;
  }
  return null;
}

// ---- TỈ LỆ ẢNH cho model (chọn tỉ lệ hỗ trợ GẦN NHẤT; số px in chính xác ép ở khâu resize) ----
// Model ảnh chỉ nhận 1 số tỉ lệ cố định → chọn cái gần nhất, tránh model treo với tỉ lệ lạ.
const SUPPORTED_ASPECTS: { s: string; r: number }[] = [
  { s: "9:16", r: 9 / 16 }, { s: "2:3", r: 2 / 3 }, { s: "3:4", r: 3 / 4 }, { s: "4:5", r: 4 / 5 },
  { s: "1:1", r: 1 }, { s: "5:4", r: 5 / 4 }, { s: "4:3", r: 4 / 3 }, { s: "3:2", r: 3 / 2 },
  { s: "16:9", r: 16 / 9 }, { s: "2:1", r: 2 }, { s: "21:9", r: 21 / 9 },
];
export function nearestAspect(w: number, h: number): string {
  const target = w / h;
  let best = SUPPORTED_ASPECTS[0];
  for (const a of SUPPORTED_ASPECTS) if (Math.abs(a.r - target) < Math.abs(best.r - target)) best = a;
  return best.s;
}
export function pageAspect(p: BookProduct): string { return nearestAspect(p.pageW, p.pageH); }
export function spreadAspect(p: BookProduct): string { return nearestAspect(p.pageW * 2, p.pageH); }
export function coverAspect(p: BookProduct): string { return nearestAspect(p.coverW, p.coverH); }

// ---- Mô tả FORMAT (nhét vào prompt) — tự nhận VUÔNG hay NGANG theo px sản phẩm ----
export function pageFormatText(p: BookProduct): string {
  const square = p.pageW === p.pageH;
  const shape = square
    ? `A SINGLE SQUARE children's storybook page, 1:1 aspect ratio`
    : `A SINGLE LANDSCAPE (wider than tall) children's storybook page, ${nearestAspect(p.pageW, p.pageH)} aspect ratio`;
  return `${shape}, printed at ${p.pageW}×${p.pageH}px @300DPI. Premium professionally-published picture-book quality. Fill the ENTIRE ${square ? "square" : "frame"}; keep the character's face and all text safely inside the trim margins.${square ? " Do NOT output a landscape/wide image." : " Do NOT output a square or portrait image."}`;
}
export function spreadFormatText(p: BookProduct, leftPage: number, rightPage: number): string {
  return `ONE CONTINUOUS DOUBLE-PAGE SPREAD = two ${p.pageW}×${p.pageH}px pages side by side (page ${leftPage} on the LEFT, page ${rightPage} on the RIGHT), total ${p.pageW * 2}×${p.pageH}px, ${nearestAspect(p.pageW * 2, p.pageH)} wide landscape. The artwork MUST flow as ONE continuous scene across the vertical center gutter.
CRITICAL — CENTER FOLD SAFETY: the exact vertical middle is a FOLD where the two pages are cut apart. Do NOT place any character, face, head, or important subject on or near the center line. Keep a wide empty "safe gutter" (about 12% of the total width) straight down the middle containing only background (sky, water, grass, scenery). Place the MAIN CHARACTER fully inside ONE half (not straddling the middle); any secondary subject must sit clearly inside the other half. Nothing important may be split by the center. Keep faces and text away from the outer edges too.`;
}
export function coverFormatText(p: BookProduct): string {
  return `ONE CONTINUOUS WRAPAROUND HARDCOVER, printed at ${p.coverW}×${p.coverH}px @300DPI (${nearestAspect(p.coverW, p.coverH)} wide landscape). This single artwork folds into two panels: the RIGHT half is the FRONT cover (an inviting hero portrait of the main character + a clear calm area for the book TITLE), and the LEFT half is the BACK cover (the SAME scene continuing seamlessly — sky, sea, landscape — with NO title and NO extra characters, a restful area). The scene MUST flow as ONE unbroken image across the vertical center fold. Keep the title, faces and important details away from the center fold and the outer edges.`;
}
