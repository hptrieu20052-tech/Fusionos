// Danh sách loại/mặt file design hợp lệ (kind là text để linh hoạt theo sản phẩm).
const pad2 = (n: number) => String(n).padStart(2, "0");

export const DESIGN_KINDS: string[] = [
  "mockup", "video",
  "design_front", "design_back", "sleeve_left", "sleeve_right",
  "cover_front", "back_cover", "book_cover",
  ...Array.from({ length: 12 }, (_, i) => `month_${pad2(i + 1)}`),
  ...Array.from({ length: 24 }, (_, i) => `page_${pad2(i + 1)}`),
];

export const isDesignKind = (k: unknown): k is string => typeof k === "string" && DESIGN_KINDS.includes(k);

// Mặt design là DUY NHẤT/thiết kế (1 file/mặt) — khác mockup/video (nhiều file).
export const isSingleSide = (k: string) => k !== "mockup" && k !== "video";
