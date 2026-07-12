#!/bin/bash
# Đóng gói extension sau khi sửa: bump "version" trong extension/manifest.json
# VÀ public/extension/version.json (trùng nhau) rồi chạy script này → commit → deploy.
# Mọi seller sẽ thấy badge NEW trong vòng 6h (hoặc khi mở lại Chrome).
set -e
cd "$(dirname "$0")/.."
node --check extension/background.js
rm -f public/extension/fusion-order-sync.zip
(cd extension && zip -rq ../public/extension/fusion-order-sync.zip .)
echo "Packed → public/extension/fusion-order-sync.zip"
