// Seed toàn bộ dữ liệu demo trong 1 lệnh.
// Chạy: node --env-file=.env scripts/seed-all.mjs
import { execSync } from "node:child_process";

const steps = [
  ["Tài khoản + quyền (users, roles, RBAC)", "seed-auth.mjs"],
  ["Dữ liệu nền (stores, sellers, designers)", "seed.mjs"],
  ["Đơn hàng + giao dịch + reviews (Dashboard/Thống kê)", "seed-demo.mjs"],
  ["Design demo có ảnh thật (40 design)", "seed-designs-demo.mjs"],
];

console.log("\n🌱 SEED TOÀN BỘ FUSION OS\n" + "=".repeat(40));
for (const [label, file] of steps) {
  console.log(`\n▶ ${label}`);
  try {
    execSync(`node --env-file=.env scripts/${file}`, { stdio: "inherit" });
  } catch {
    console.error(`⚠ Lỗi ở ${file} — bỏ qua, chạy tiếp bước sau`);
  }
}
console.log("\n" + "=".repeat(40));
console.log("✅ XONG. Đăng nhập: admin@fusion.co / fusion123");
console.log("   Các tài khoản khác: tri@, ha@, lan@ (seller) · anh@, quy@, quang@ (designer) · linh@ (content) — cùng mật khẩu fusion123\n");
