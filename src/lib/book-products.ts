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
    name: "Hardcover Photo Book (8×8 · 24 trang)",
    pageCount: 24,
    pageW: 2400, pageH: 2400,     // mỗi trang 2400×2400
    coverW: 5370, coverH: 2850,   // cover 5370×2850
  },
];

export function getBookProduct(key?: string | null): BookProduct {
  return BOOK_PRODUCTS.find((p) => p.key === key) ?? BOOK_PRODUCTS[0];
}

// KHỐI GEN: cover (rộng) + trang đơn (trang 1, trang cuối) + spread NỐI 2:1 cho các cặp giữa.
// Spread vẽ 1 ảnh liền 2:1 (nghệ thuật nối qua gáy) rồi CẮT ĐÔI thành 2 file trang vuông khi xuất.
export type GenBlock =
  | { type: "cover"; w: number; h: number }
  | { type: "single"; page: number; w: number; h: number }
  | { type: "spread"; pages: [number, number]; w: number; h: number };

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
