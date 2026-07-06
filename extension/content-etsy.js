// FUSION Order Sync — Etsy orders page. v0.1 skeleton, selector tinh chỉnh sau.
console.log("[FUSION] Etsy content script loaded");
const btn = document.createElement("button");
btn.textContent = "⚡ Sync FUSION";
btn.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:99999;background:#2F54EB;color:#fff;border:0;border-radius:12px;padding:10px 16px;font-weight:700;cursor:pointer";
btn.onclick = () => {
  const orders = [...document.querySelectorAll("[data-order-id]")].map((el) => ({
    externalId: el.getAttribute("data-order-id"),
    orderedAt: new Date().toISOString(),
    items: [{ productTitle: (el.querySelector("a")?.textContent || "Etsy item").trim() }],
  }));
  chrome.runtime.sendMessage(
    { type: "FUSION_ORDERS", payload: { platform: "etsy", source: "extension", orders } },
    (res) => console.log("[FUSION] Sync result:", res)
  );
};
document.body.appendChild(btn);
