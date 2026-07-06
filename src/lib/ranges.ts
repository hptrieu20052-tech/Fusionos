// Helper dùng chung cho các API thống kê theo khoảng thời gian.
// range: today | yesterday | 3d | 7d | this_month | last_month | this_year | custom
// custom cần from/to dạng YYYY-MM-DD (được validate trước khi nhúng vào SQL).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function rangeCond(col: string, range: string, from?: string | null, to?: string | null): string {
  switch (range) {
    case "today": return `${col}::date = CURRENT_DATE`;
    case "yesterday": return `${col}::date = CURRENT_DATE - 1`;
    case "3d": return `${col}::date >= CURRENT_DATE - 2`;
    case "7d": return `${col}::date >= CURRENT_DATE - 6`;
    case "30d": return `${col}::date >= CURRENT_DATE - 29`;
    case "this_month": return `date_trunc('month', ${col}) = date_trunc('month', CURRENT_DATE)`;
    case "last_month": return `date_trunc('month', ${col}) = date_trunc('month', CURRENT_DATE) - interval '1 month'`;
    case "this_year": return `date_trunc('year', ${col}) = date_trunc('year', CURRENT_DATE)`;
    case "custom": {
      const f = from && DATE_RE.test(from) ? from : null;
      const t = to && DATE_RE.test(to) ? to : null;
      if (f && t) return `${col}::date BETWEEN '${f}' AND '${t}'`;
      if (f) return `${col}::date >= '${f}'`;
      if (t) return `${col}::date <= '${t}'`;
      return `${col}::date >= CURRENT_DATE - 6`;
    }
    default: return `${col}::date >= CURRENT_DATE - 6`;
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
