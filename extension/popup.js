const $ = (id) => document.getElementById(id);
function msg(t, ok) { const m = $("msg"); m.style.display = "block"; m.textContent = t; m.style.background = ok ? "#E7F6EC" : "#FDECEC"; m.style.color = ok ? "#15803d" : "#D14343"; }
async function load() {
  const cfg = (await chrome.storage.local.get("fp_cfg")).fp_cfg || {};
  $("url").value = cfg.url || ""; $("token").value = cfg.token || "";
  chrome.runtime.sendMessage({ type: "count" }, (r) => { if (r) $("cnt").textContent = `Captured: ${r.count} orders`; });
}
$("save").onclick = async () => {
  await chrome.storage.local.set({ fp_cfg: { url: $("url").value.trim(), token: $("token").value.trim() } });
  msg("✓ Config saved.", true);
};
$("clear").onclick = () => chrome.runtime.sendMessage({ type: "clear" }, () => { $("cnt").textContent = "Captured: 0 orders"; msg("Order buffer cleared.", true); });
$("sync").onclick = () => {
  msg("Pushing…", true);
  chrome.runtime.sendMessage({ type: "sync" }, (r) => {
    if (!r) return msg("No response.", false);
    if (r.ok) { msg(`✓ Received ${r.received} — created ${r.created}, skipped ${r.skipped}` + (r.errors && r.errors.length ? ` · ${r.errors.length} errors` : ""), true); $("cnt").textContent = "Captured: 0 orders"; }
    else msg("✗ " + r.error, false);
  });
};
load();

// Banner bản mới → link tải
chrome.storage.local.get("updateAvailable", ({ updateAvailable }) => {
  if (!updateAvailable) return;
  const d = document.createElement("div");
  d.style.cssText = "margin-top:10px;background:#FDECEC;color:#D14343;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700";
  d.innerHTML = 'New version ' + updateAvailable + ' — <a href="https://os.fusiondn.com/extension/" target="_blank" style="color:#0D4C9B">download & reload</a>';
  document.body.appendChild(d);
});
