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

// ===== Auto-update check: so version với server FUSION, có bản mới → badge NEW =====
// Chrome không cho load-unpacked tự cập nhật ngầm → nhắc + 1 click tải bản mới.
const UPDATE_BASE = "https://os.fusiondn.com";

function cmpVer(a, b) { // 1 nếu a > b
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

async function checkUpdate() {
  try {
    const r = await fetch(`${UPDATE_BASE}/extension/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    const cur = chrome.runtime.getManifest().version;
    if (j.version && cmpVer(j.version, cur) > 0) {
      await chrome.storage.local.set({ updateAvailable: j.version });
      chrome.action.setBadgeText({ text: "NEW" });
      chrome.action.setBadgeBackgroundColor({ color: "#D93025" });
      chrome.action.setTitle({ title: `FUSION Order Sync — new version ${j.version} available, click to download` });
    } else {
      await chrome.storage.local.remove("updateAvailable");
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "FUSION Order Sync" });
    }
  } catch { /* offline thì thôi */ }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("fusion-update-check", { periodInMinutes: 360 }); // 6h/lần
  checkUpdate();
});
chrome.runtime.onStartup.addListener(checkUpdate);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "fusion-update-check") checkUpdate(); });

// Click icon: có bản mới → mở trang tải; không thì mở FUSION
chrome.action.onClicked.addListener(async () => {
  const { updateAvailable } = await chrome.storage.local.get("updateAvailable");
  chrome.tabs.create({ url: updateAvailable ? `${UPDATE_BASE}/extension/` : UPDATE_BASE });
});
