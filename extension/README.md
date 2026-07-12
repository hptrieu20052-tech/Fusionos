# Fusion Etsy Puller — pull Etsy orders into FUSION OS (SAFE mode)

Pulls orders from your own logged-in Etsy session into FUSION, **without using the Etsy API/keys**.

## Why it's safe for your shop (Etsy is strict)
- ❌ **Makes no extra requests to Etsy.** It only "reads along" the order data Etsy already loads while you view the Orders page → no unusual traffic, no rate-limit/anti-bot triggers.
- ❌ **Sends / edits / deletes nothing on Etsy** (strictly read-only).
- ❌ **No automation, no timers, no polling.** Runs only when you open the Orders page; pushes only when you click.
- ✅ **Only loads on the Orders area** (`etsy.com/your/*`), not the rest of Etsy, and not inside iframes.
- ✅ The `fetch`/`XHR` hook is **observe-only** (clones responses), never modifies requests/responses; everything is wrapped in try/catch so it can never break the Etsy page; toString is spoofed to native.
- ✅ It **does not store raw Etsy data** — only the few fields needed for an order, held briefly in the browser, cleared after pushing.

## Install (Chrome/Edge)
1. Unzip this folder.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `fusion-etsy-puller` folder.

## Configure
1. In FUSION: **Stores → open the Etsy store → "Etsy puller extension" section** → copy the **Ingest URL** + **Store token**.
2. On the on-page panel (or the toolbar icon), open **Configure**, paste the URL + token → **Save**.

## Use
1. Open Etsy: **Shop Manager → Orders & Shipping**, scroll/open orders so Etsy loads them normally.
2. The floating panel shows the captured count → click **Push to FUSION**.
3. FUSION creates NEW orders and skips duplicates by Order ID.

## Customize
- If Etsy changes its data shape → edit the `normalize` function in `background.js`.
- Using a custom FUSION domain (not *.vercel.app) → add it to `host_permissions` in `manifest.json`.
