// Danh sách loại/mặt file design hợp lệ (kind là text để linh hoạt theo sản phẩm).
const pad2 = (n: number) => String(n).padStart(2, "0");

// FILE MÁY THÊU (.dst/.emb/…) — nhận diện theo ĐUÔI FILE, không theo kind, vì kind là text tự do.
// Dùng chung cho: chặn tạo thumbnail, lọc khi đẩy đơn, gợi ý mặt khi upload folder.
export const EMB_FILE_RX = /\.(emb|dst|pes|exp|jef|vp3|xxx)(\?|#|$)/i;
export const isEmbFile = (nameOrUrl: unknown) => typeof nameOrUrl === "string" && EMB_FILE_RX.test(nameOrUrl);

// Mặt "file máy thêu" đi KÈM mặt ảnh cùng vị trí: 1 vị trí thêu = 2 file (ảnh design + file máy).
export const EMB_KINDS: string[] = ["emb_front", "emb_back", "emb_left", "emb_right", "emb_center"];
export const isEmbKind = (k: unknown): k is string => typeof k === "string" && EMB_KINDS.includes(k);

export const DESIGN_KINDS: string[] = [
  "mockup", "video",
  "design_front", "design_back", "sleeve_left", "sleeve_right",
  ...EMB_KINDS,
  "cover_front", "back_cover", "book_cover",
  ...Array.from({ length: 12 }, (_, i) => `month_${pad2(i + 1)}`),
  // Wall Calendars (Blank): dùng lại cover_front / month_01..12 / back_cover, chỉ thêm 12 mặt lưới lịch
  ...Array.from({ length: 12 }, (_, i) => `grid_${pad2(i + 1)}`),
  ...Array.from({ length: 24 }, (_, i) => `page_${pad2(i + 1)}`),
];

export const isDesignKind = (k: unknown): k is string => typeof k === "string" && DESIGN_KINDS.includes(k);

// Mặt design là DUY NHẤT/thiết kế (1 file/mặt) — khác mockup/video (nhiều file).
export const isSingleSide = (k: string) => k !== "mockup" && k !== "video";
