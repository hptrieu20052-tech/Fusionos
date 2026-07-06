export type Lang = "vi" | "en";

// Từ điển song ngữ. Key theo dạng "nhóm.mục".
const DICT: Record<string, { vi: string; en: string }> = {
  // Nav
  "nav.dashboard": { vi: "Dashboard", en: "Dashboard" },
  "nav.orders": { vi: "Đơn hàng", en: "Orders" },
  "nav.fulfillment": { vi: "Fulfillment", en: "Fulfillment" },
  "nav.designs": { vi: "Design Studio", en: "Design Studio" },
  "nav.reviews": { vi: "Chấm điểm", en: "Scoring" },
  "nav.statsOrders": { vi: "TK Đơn", en: "Order Stats" },
  "nav.statsDesigners": { vi: "TK Designer", en: "Designer Stats" },
  "nav.finance": { vi: "Tài chính", en: "Finance" },
  "nav.stores": { vi: "Cửa hàng", en: "Stores" },
  "nav.settings": { vi: "Cài đặt", en: "Settings" },
  "nav.admin": { vi: "Quản trị", en: "Admin" },
  "nav.logout": { vi: "Đăng xuất", en: "Log out" },

  // Common
  "c.all": { vi: "Tất cả", en: "All" },
  "c.search": { vi: "Tìm kiếm", en: "Search" },
  "c.seller": { vi: "Seller", en: "Seller" },
  "c.store": { vi: "Store", en: "Store" },
  "c.marketplace": { vi: "Sàn", en: "Marketplace" },
  "c.supplier": { vi: "Supplier", en: "Supplier" },
  "c.designer": { vi: "Designer", en: "Designer" },
  "c.status": { vi: "Trạng thái", en: "Status" },
  "c.date": { vi: "Ngày", en: "Date" },
  "c.createdDate": { vi: "Ngày tạo", en: "Created date" },
  "c.orderedDate": { vi: "Ngày đặt", en: "Order date" },
  "c.save": { vi: "Lưu", en: "Save" },
  "c.cancel": { vi: "Huỷ", en: "Cancel" },
  "c.close": { vi: "Đóng", en: "Close" },
  "c.delete": { vi: "Xoá", en: "Delete" },
  "c.edit": { vi: "Sửa", en: "Edit" },
  "c.export": { vi: "Export", en: "Export" },
  "c.import": { vi: "Import", en: "Import" },
  "c.create": { vi: "Tạo", en: "Create" },
  "c.loading": { vi: "Đang tải…", en: "Loading…" },
  "c.saving": { vi: "Đang lưu…", en: "Saving…" },
  "c.none": { vi: "—", en: "—" },
  "c.note": { vi: "Ghi chú", en: "Note" },
  "c.total": { vi: "Tổng", en: "Total" },
  "c.revenue": { vi: "Doanh thu", en: "Revenue" },
  "c.orders": { vi: "đơn", en: "orders" },
  "c.items": { vi: "items", en: "items" },
  "c.clearFilter": { vi: "Xoá lọc", en: "Clear filter" },
  "c.show": { vi: "Hiển thị", en: "Show" },

  // Date range presets
  "dr.today": { vi: "Hôm nay", en: "Today" },
  "dr.yesterday": { vi: "Hôm qua", en: "Yesterday" },
  "dr.7d": { vi: "7 ngày", en: "7 days" },
  "dr.30d": { vi: "30 ngày", en: "30 days" },
  "dr.thisMonth": { vi: "Tháng này", en: "This month" },
  "dr.lastMonth": { vi: "Tháng trước", en: "Last month" },
  "dr.thisYear": { vi: "Năm nay", en: "This year" },
  "dr.allTime": { vi: "Mọi thời gian", en: "All time" },
  "dr.custom": { vi: "Tuỳ chọn", en: "Custom" },

  // Dashboard
  "db.timeRange": { vi: "Khoảng thời gian", en: "Time range" },
  "db.kpiOrders": { vi: "Đơn hàng", en: "Orders" },
  "db.kpiRevenue": { vi: "Doanh thu", en: "Revenue" },
  "db.kpiProfit": { vi: "Dự toán lợi nhuận", en: "Est. profit" },
  "db.kpiNew": { vi: "Đơn NEW chờ xử lý", en: "NEW orders pending" },
  "db.kpiIssues": { vi: "Đơn lỗi cần xử lý", en: "Orders with issues" },
  "db.toFulfill": { vi: "vào Fulfillment để đẩy →", en: "go to Fulfillment →" },
  "db.viewIssues": { vi: "Has Issues — xem ngay →", en: "Has Issues — view →" },
  "db.noIssues": { vi: "Không có đơn lỗi", en: "No orders with issues" },
  "db.teamReport": { vi: "Team Report", en: "Team Report" },
  "db.sellerReport": { vi: "Seller Report", en: "Seller Report" },
  "db.designerReport": { vi: "Designer Report", en: "Designer Report" },
  "db.viewDetail": { vi: "Xem chi tiết →", en: "View detail →" },

  // Orders
  "o.title": { vi: "Đơn hàng", en: "Orders" },
  "o.searchPlaceholder": { vi: "Mã đơn, tên khách, sản phẩm…", en: "Order ID, customer, product…" },
  "o.createOrder": { vi: "Tạo đơn +", en: "Create order +" },
  "o.selectPage": { vi: "Chọn cả trang", en: "Select page" },
  "o.selected": { vi: "đơn đã chọn", en: "selected" },
  "o.changeStatus": { vi: "Chuyển trạng thái", en: "Change status" },
  "o.apply": { vi: "Áp dụng", en: "Apply" },
  "o.deselectAll": { vi: "Bỏ chọn tất cả", en: "Deselect all" },
  "o.shipBy": { vi: "Ship by", en: "Ship by" },
  "o.fullAddress": { vi: "Full Address", en: "Full Address" },
  "o.afterFee": { vi: "after Fee", en: "after Fee" },
  "o.fee": { vi: "Fee", en: "Fee" },
  "o.createNote": { vi: "+ Create Note", en: "+ Create Note" },
  "o.completeOrder": { vi: "Complete Order", en: "Complete Order" },
  "o.hasIssues": { vi: "Has Issues", en: "Has Issues" },
  "o.trash": { vi: "Trash", en: "Trash" },
  "o.dup": { vi: "Dup", en: "Dup" },
  "o.downloadInfo": { vi: "Download Order Info", en: "Download Order Info" },

  // Designs
  "d.bulkUpload": { vi: "Bulk upload +", en: "Bulk upload +" },
  "d.searchPlaceholder": { vi: "Tên design hoặc ID…", en: "Design name or ID…" },
  "d.noMatch": { vi: "Không có design nào khớp bộ lọc.", en: "No designs match the filter." },
  "d.more": { vi: "More", en: "More" },
  "d.design": { vi: "design", en: "designs" },

  // Stores
  "s.addStore": { vi: "+ Thêm store", en: "+ Add store" },
  "s.totalRev30": { vi: "Tổng doanh thu 30 ngày", en: "Total revenue 30d" },
  "s.live": { vi: "LIVE", en: "LIVE" },
  "s.die": { vi: "DIE", en: "DIE" },
  "s.empty": { vi: "Trống", en: "Empty" },
  "s.noApi": { vi: "chưa có API", en: "no API" },
  "s.apiConfigured": { vi: "đã cấu hình", en: "configured" },
  "s.apiConfig": { vi: "Cấu hình API", en: "API Configuration" },
  "s.checkConn": { vi: "Check kết nối", en: "Check connection" },
  "s.noOrderDays": { vi: "ngày không có đơn", en: "days without orders" },
  "s.connectMethod": { vi: "Kết nối", en: "Connection" },
};

export function translate(lang: Lang, key: string): string {
  const e = DICT[key];
  if (!e) return key;
  return e[lang] ?? e.vi;
}
