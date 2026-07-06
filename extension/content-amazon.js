// FUSION Order Sync — Amazon Seller Central (orders-v3)
// v0.1: parse bảng đơn cơ bản. Selector cần tinh chỉnh theo layout thực tế của tài khoản.
console.log("[FUSION] Amazon content script loaded");

function parseOrders() {
  const rows = document.querySelectorAll("table tbody tr");
  const orders = [];
  rows.forEach((tr) => {
    const text = tr.innerText || "";
    const idMatch = text.match(/\d{3}-\d{7}-\d{7}/); // format order ID Amazon
    if (!idMatch) return;
    orders.push({
      externalId: idMatch[0],
      orderedAt: new Date().toISOString(),
      platformStatus: /unshipped/i.test(text) ? "UNSHIPPED" : undefined,
      items: [{ productTitle: (tr.querySelector("a")?.textContent || "").trim() || "Amazon item" }],
    });
  });
  return orders;
}

function sync() {
  const orders = parseOrders();
  if (!orders.length) return console.log("[FUSION] Không tìm thấy đơn trên trang");
  chrome.runtime.sendMessage(
    { type: "FUSION_ORDERS", payload: { platform: "amazon", source: "extension", orders } },
    (res) => console.log("[FUSION] Sync result:", res)
  );
}

// Nút sync nổi
const btn = document.createElement("button");
btn.textContent = "⚡ Sync FUSION";
btn.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:99999;background:#2F54EB;color:#fff;border:0;border-radius:12px;padding:10px 16px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px rgba(47,84,235,.4)";
btn.onclick = sync;
document.body.appendChild(btn);
