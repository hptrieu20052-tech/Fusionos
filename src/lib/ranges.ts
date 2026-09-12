// Helper dùng chung cho các API thống kê theo khoảng thời gian.
// range: today | yesterday | 3d | 7d | this_month | last_month | this_year | custom
// custom cần from/to dạng YYYY-MM-DD (được validate trước khi nhúng vào SQL).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// v473 · Điều kiện viết dạng SO SÁNH THẲNG TRÊN CỘT (sargable) — KHÔNG bọc cột trong ::date hay
// date_trunc() nữa: dạng bọc hàm làm Postgres không dùng được index trên cột thời gian và dễ
// chọn plan sai (khoảng GẦN ĐÂY chạy cực chậm/timeout trong khi khoảng cũ vẫn nhanh).
// Ranh giới ngày GIỮ NGUYÊN ngữ nghĩa cũ (theo timezone session — Supabase là UTC).
export function rangeCond(col: string, range: string, from?: string | null, to?: string | null): string {
  switch (range) {
    case "today": return `(${col} >= CURRENT_DATE AND ${col} < CURRENT_DATE + 1)`;
    case "yesterday": return `(${col} >= CURRENT_DATE - 1 AND ${col} < CURRENT_DATE)`;
    case "3d": return `${col} >= CURRENT_DATE - 2`;
    case "7d": return `${col} >= CURRENT_DATE - 6`;
    case "30d": return `${col} >= CURRENT_DATE - 29`;
    case "this_month": return `(${col} >= date_trunc('month', CURRENT_DATE) AND ${col} < date_trunc('month', CURRENT_DATE) + interval '1 month')`;
    case "last_month": return `(${col} >= date_trunc('month', CURRENT_DATE) - interval '1 month' AND ${col} < date_trunc('month', CURRENT_DATE))`;
    case "this_year": return `(${col} >= date_trunc('year', CURRENT_DATE) AND ${col} < date_trunc('year', CURRENT_DATE) + interval '1 year')`;
    case "custom": {
      const f = from && DATE_RE.test(from) ? from : null;
      const t = to && DATE_RE.test(to) ? to : null;
      if (f && t) return `(${col} >= '${f}' AND ${col} < '${t}'::date + 1)`;
      if (f) return `${col} >= '${f}'`;
      if (t) return `${col} < '${t}'::date + 1`;
      return `${col} >= CURRENT_DATE - 6`;
    }
    default: return `${col} >= CURRENT_DATE - 6`;
  }
}

// Gom theo tháng nếu khoảng dài (>62 ngày), ngược lại theo ngày
export function isMonthly(range: string, from?: string | null, to?: string | null): boolean {
  if (range === "this_year") return true;
  if (range === "custom" && from && to && DATE_RE.test(from) && DATE_RE.test(to)) {
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
    return days > 62;
  }
  return false;
}

export function bucketExprs(col: string, monthly: boolean) {
  return {
    bucketExpr: monthly ? `to_char(date_trunc('month', ${col}), 'MM/YYYY')` : `to_char(${col}::date, 'DD/MM')`,
    bucketOrd: monthly ? `date_trunc('month', ${col})` : `${col}::date`,
  };
}
