"use client";
import { useState } from "react";

// Hành trình phát triển — chỉnh năm/tiêu đề tùy ý; ảnh đặt trong /public/journey/<tên file>.
// Nếu chưa có ảnh, ô sẽ hiện nền gradient kèm năm (không bị vỡ ảnh).
const JOURNEY = [
  { year: "2021", title: "Những bước đi đầu tiên", img: "/journey/2021.jpg" },
  { year: "2022", title: "Mở rộng đội ngũ & thị trường", img: "/journey/2022.jpg" },
  { year: "2023", title: "Tăng trưởng bứt phá", img: "/journey/2023.jpg" },
  { year: "2024", title: "Vươn tầm đa nền tảng", img: "/journey/2024.jpg" },
  { year: "2025", title: "Chuẩn hoá vận hành với Fusion OS", img: "/journey/2025.jpg" },
];

function JImg({ src, year }: { src: string; year: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="lg-jimg lg-jimg-fallback"><span>{year}</span></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="lg-jimg" src={src} alt={year} onError={() => setFailed(true)} />;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember }),
    });
    if (res.ok) {
      const next = new URLSearchParams(location.search).get("next") ?? "/";
      location.href = next;
    } else {
      setErr("Sai email hoặc mật khẩu");
      setBusy(false);
    }
  }

  return (
    <div className="lg-root">
      <style>{`
        .lg-root{position:fixed;inset:0;display:flex;background:#fff;overflow:hidden;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
        .lg-left{flex:1.05;position:relative;overflow:hidden;color:#fff;display:flex;flex-direction:column;justify-content:center;
          background:linear-gradient(150deg,#003c84 0%,#0a3f8f 42%,#3b2f8f 78%,#5b2f8f 100%)}
        .lg-left-inner{padding:44px 56px;max-width:640px;width:100%}
        .lg-right{flex:.95;display:flex;align-items:center;justify-content:center;padding:32px;overflow:hidden}
        .lg-form{width:100%;max-width:400px}
        .lg-brand{display:flex;align-items:center;gap:12px;margin-bottom:18px}
        .lg-brand-chip{width:50px;height:50px;border-radius:14px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.18);flex-shrink:0}
        .lg-brand-chip img{width:32px;height:32px;object-fit:contain}
        .lg-brand-name{font-size:21px;font-weight:800;letter-spacing:.5px;line-height:1}
        .lg-brand-tag{font-size:11px;opacity:.8;margin-top:3px}
        .lg-sub{font-size:11.5px;letter-spacing:2px;text-transform:uppercase;opacity:.7;margin-bottom:8px;font-weight:700}
        .lg-h1{font-size:27px;font-weight:800;line-height:1.15;margin-bottom:12px}
        .lg-p{font-size:13.5px;line-height:1.65;opacity:.9;margin-bottom:6px}
        .lg-p b{font-weight:700;color:#bfe3ff}
        .lg-hr{height:1px;background:rgba(255,255,255,.18);margin:20px 0 18px}
        .lg-jtitle{font-weight:800;font-size:15px;margin-bottom:16px}
        .lg-timeline{display:flex;flex-direction:column;gap:14px;position:relative}
        .lg-jrow{display:flex;align-items:center;gap:16px;position:relative}
        .lg-jimg{width:58px;height:58px;border-radius:13px;object-fit:cover;flex-shrink:0;box-shadow:0 4px 12px rgba(0,0,0,.22);border:2px solid rgba(255,255,255,.35)}
        .lg-jimg-fallback{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(255,255,255,.28),rgba(255,255,255,.08))}
        .lg-jimg-fallback span{font-size:13px;font-weight:800;color:#fff;opacity:.95}
        .lg-jyear{font-size:16px;font-weight:800;color:#bfe3ff;line-height:1.1}
        .lg-jdesc{font-size:13px;opacity:.9;line-height:1.35;margin-top:2px}
        .lg-copy{font-size:11.5px;opacity:.6;margin-top:22px}
        .lg-ftitle{font-size:26px;font-weight:800;margin-bottom:4px}
        .lg-fsub{color:var(--muted,#4a5a6a);font-size:13.5px;margin-bottom:26px}
        .lg-label{display:block;font-size:12.5px;font-weight:700;color:#33445a;margin:0 0 6px}
        .lg-inwrap{position:relative}
        .lg-input{width:100%;padding:13px 15px;border:1px solid #dbe1e8;border-radius:12px;font:inherit;font-size:14px;outline:none;transition:border .15s,box-shadow .15s;color:#1e2a3a}
        .lg-input:focus{border-color:#0095e8;box-shadow:0 0 0 3px rgba(0,149,232,.15)}
        .lg-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;color:#8595a5;padding:4px;display:flex}
        .lg-row{display:flex;justify-content:space-between;align-items:baseline;margin-top:18px}
        .lg-forgot{font-size:12.5px;color:#0095e8;font-weight:600;cursor:pointer;background:none;border:0}
        .lg-remember{display:flex;align-items:center;gap:9px;margin:16px 0 20px;cursor:pointer;user-select:none;font-size:13.5px;color:#33445a}
        .lg-remember input{width:18px;height:18px;accent-color:#003c84;cursor:pointer}
        .lg-btn{width:100%;background:linear-gradient(135deg,#0095e8,#003c84);color:#fff;border:0;border-radius:12px;padding:14px;font-weight:800;font-size:15px;cursor:pointer;transition:opacity .15s,transform .05s}
        .lg-btn:hover{opacity:.93}.lg-btn:active{transform:translateY(1px)}.lg-btn:disabled{opacity:.6;cursor:default}
        .lg-err{color:#ef4444;font-weight:700;font-size:12.5px;margin-top:12px}
        .lg-terms{text-align:center;font-size:12px;color:#8595a5;margin-top:16px;line-height:1.6}
        .lg-terms b{color:#33445a;font-weight:700}
        .lg-dev{text-align:center;font-size:12.5px;color:#4a5a6a;margin-top:20px;padding-top:16px;border-top:1px solid #eef1f4}
        .lg-dev b{color:#003c84}
        .lg-mobilebrand{display:none}
        @media(max-width:880px){
          .lg-left{display:none}
          .lg-right{flex:1;overflow-y:auto}
          .lg-mobilebrand{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:24px}
          .lg-mobilebrand img{width:38px;height:38px;object-fit:contain}
          .lg-mobilebrand b{font-size:20px;font-weight:800;color:#003c84}
        }
        @media(max-height:720px){
          .lg-left-inner{padding:26px 56px}
          .lg-h1{font-size:23px;margin-bottom:8px}
          .lg-timeline{gap:10px}
          .lg-jimg,.lg-jimg-fallback{width:48px;height:48px}
          .lg-hr{margin:14px 0}
        }
      `}</style>

      {/* CỘT TRÁI — thương hiệu & hành trình phát triển */}
      <div className="lg-left">
        <div className="lg-left-inner">
          <div className="lg-brand">
            <div className="lg-brand-chip"><img src="/logomark.png" alt="Fusion" /></div>
            <div>
              <div className="lg-brand-name">FUSION</div>
              <div className="lg-brand-tag">together we grow</div>
            </div>
          </div>
          <div className="lg-sub">Hệ thống quản lý nội bộ</div>
          <h1 className="lg-h1">Chào mừng đến với FUSION</h1>
          <p className="lg-p">Công ty <b>Print-on-Demand &amp; TMĐT xuyên biên giới</b>, phục vụ khách hàng tại <b>Mỹ và Châu Âu</b> qua Amazon, TikTok, Etsy và Shopify.</p>

          <div className="lg-hr" />
          <div className="lg-jtitle">Hành trình phát triển</div>
          <div className="lg-timeline">
            {JOURNEY.map((j) => (
              <div className="lg-jrow" key={j.year}>
                <JImg src={j.img} year={j.year} />
                <div>
                  <div className="lg-jyear">{j.year}</div>
                  <div className="lg-jdesc">{j.title}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="lg-copy">© 2026 FUSION CO., LTD.</div>
        </div>
      </div>

      {/* CỘT PHẢI — form đăng nhập */}
      <div className="lg-right">
        <div className="lg-form">
          <div className="lg-mobilebrand"><img src="/logomark.png" alt="" /><b>FUSION</b></div>
          <div className="lg-ftitle">Đăng nhập</div>
          <div className="lg-fsub">Tài khoản nội bộ do Admin cấp.</div>

          <form onSubmit={submit}>
            <label className="lg-label" htmlFor="lg-email">Email</label>
            <input id="lg-email" className="lg-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" type="email" required autoComplete="username" />

            <div className="lg-row">
              <label className="lg-label" htmlFor="lg-pass" style={{ margin: 0 }}>Mật khẩu</label>
              <button type="button" className="lg-forgot" onClick={() => setErr("Liên hệ Admin để đặt lại mật khẩu.")}>Quên mật khẩu?</button>
            </div>
            <div className="lg-inwrap" style={{ marginTop: 6 }}>
              <input id="lg-pass" className="lg-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" type={show ? "text" : "password"} required autoComplete="current-password" style={{ paddingRight: 44 }} />
              <button type="button" className="lg-eye" onClick={() => setShow((s) => !s)} aria-label="Hiện/ẩn mật khẩu">
                {show
                  ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>}
              </button>
            </div>

            <label className="lg-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Ghi nhớ đăng nhập trên thiết bị này
            </label>

            <button className="lg-btn" disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
            {err && <div className="lg-err">{err}</div>}
          </form>

          <div className="lg-terms">Bằng cách đăng nhập, bạn đồng ý với <b>quy định nội bộ</b> của Fusion.</div>
          <div className="lg-dev">✦ Được phát triển nội bộ · <b>Fusion OS</b></div>
        </div>
      </div>
    </div>
  );
}
