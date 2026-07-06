"use client";
export function LogoutButton() {
  return (
    <button
      onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); location.href = "/login"; }}
      style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 13px", fontWeight: 700, cursor: "pointer", font: "inherit", fontSize: 12.5 }}
    >
      Đăng xuất
    </button>
  );
}
