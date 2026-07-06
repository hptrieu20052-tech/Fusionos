// Nhận đơn từ content script → gửi về FUSION OS
// Cấu hình: chrome.storage.local.set({ apiUrl: "https://app.fusion.co", apiKey: "..." })
const DEFAULT_API = "http://localhost:3000";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "FUSION_ORDERS") return;
  (async () => {
    const { apiUrl = DEFAULT_API, apiKey = "fusion-ingest-dev-key-change-me" } =
      await chrome.storage.local.get(["apiUrl", "apiKey"]);
    try {
      const res = await fetch(`${apiUrl}/api/ingest/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(msg.payload),
      });
      sendResponse({ ok: res.ok, result: await res.json() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // async response
});
