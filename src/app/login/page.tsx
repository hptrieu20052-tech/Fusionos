"use client";
import { useEffect, useState } from "react";
import { JOURNEY_IMG } from "./journey-images";

// Hành trình phát triển — ảnh chính lấy từ /public/journey/<năm>.jpg (thay bằng commit file),
// có base64 lưới đỡ trong ./journey-images.ts nếu file lỗi/chưa deploy.
const JOURNEY = [
  { year: "2021", title: "Những bước đi đầu tiên" },
  { year: "2022", title: "Mở rộng đội ngũ & thị trường" },
  { year: "2023", title: "Tăng trưởng bứt phá" },
  { year: "2024", title: "Vươn tầm đa nền tảng" },
  { year: "2025", title: "Chuẩn hoá vận hành với Fusion OS" },
];
const SLIDE_MS = 3500;

// Ảnh: thử file public trước → base64 → ô năm. Dùng cho cả thumbnail nhỏ và slide lớn.
function useImgSrc(year: string) {
  const [stage, setStage] = useState(0);
  const b64 = JOURNEY_IMG[year];
  const broken = stage >= 2 || (stage === 1 && !b64);
  const src = stage === 0 ? `/journey/${year}.jpg` : b64;
  return { src, broken, onError: () => setStage((s) => s + 1) };
}

function Thumb({ year }: { year: string }) {
  const { src, broken, onError } = useImgSrc(year);
  if (broken) return <div className="lg-thumb lg-thumb-fb"><span>{year}</span></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="lg-thumb" src={src} alt={year} onError={onError} />;
}

function SlideLayer({ year, on }: { year: string; on: boolean }) {
  const { src, broken, onError } = useImgSrc(year);
  return (
    <div className="lg-slide-layer" style={{ opacity: on ? 1 : 0 }}>
      {broken ? <div className="lg-slide-fb">{year}</div>
        // eslint-disable-next-line @next/next/no-img-element
        : <img className="lg-slide-img" src={src} alt={year} onError={onError} />}
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [active, setActive] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % JOURNEY.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [resetKey]);
  const pick = (i: number) => { setActive(i); setResetKey((k) => k + 1); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember }),
    });
    if (res.ok) { location.href = new URLSearchParams(location.search).get("next") ?? "/"; }
    else { setErr("Sai email hoặc mật khẩu"); setBusy(false); }
  }

  return (
    <div className="lg-root">
      <style>{`
        .lg-root{position:fixed;inset:0;display:flex;background:#fff;overflow:hidden;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
        .lg-left{flex:1.15;position:relative;overflow:hidden;color:#fff;display:flex;flex-direction:column;justify-content:center;
          background:linear-gradient(150deg,#003c84 0%,#0a3f8f 42%,#3b2f8f 78%,#5b2f8f 100%)}
        .lg-left-inner{padding:38px 52px;width:100%}
        .lg-right{flex:.85;display:flex;align-items:center;justify-content:center;padding:32px;overflow:hidden}
        .lg-form{width:100%;max-width:400px}
        .lg-brand{display:flex;align-items:center;gap:12px;margin-bottom:14px}
        .lg-brand-chip{width:50px;height:50px;border-radius:14px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.18);flex-shrink:0}
        .lg-brand-chip img{width:32px;height:32px;object-fit:contain}
        .lg-brand-name{font-size:21px;font-weight:800;letter-spacing:.5px;line-height:1}
        .lg-brand-tag{font-size:11px;opacity:.8;margin-top:3px}
        .lg-sub{font-size:11.5px;letter-spacing:2px;text-transform:uppercase;opacity:.7;margin-bottom:7px;font-weight:700}
        .lg-h1{font-size:26px;font-weight:800;line-height:1.15;margin-bottom:9px}
        .lg-p{font-size:13.5px;line-height:1.6;opacity:.9;max-width:620px}
        .lg-p b{font-weight:700;color:#bfe3ff}
        .lg-hr{height:1px;background:rgba(255,255,255,.18);margin:16px 0 14px}
        .lg-jtitle{font-weight:800;font-size:15px;margin-bottom:12px}

        .lg-body{display:flex;gap:30px;align-items:stretch}
        .lg-tl{width:300px;flex-shrink:0;display:flex;flex-direction:column;gap:6px}
        .lg-tlrow{display:flex;align-items:center;gap:13px;padding:7px 9px;border-radius:12px;cursor:pointer;border:1px solid transparent;transition:background .18s,border .18s}
        .lg-tlrow:hover{background:rgba(255,255,255,.07)}
        .lg-tlrow.on{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.25)}
        .lg-thumb{width:44px;height:44px;border-radius:10px;object-fit:cover;flex-shrink:0;border:2px solid rgba(255,255,255,.35)}
        .lg-thumb-fb{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(255,255,255,.28),rgba(255,255,255,.08))}
        .lg-thumb-fb span{font-size:12px;font-weight:800}
        .lg-jyear{font-size:15.5px;font-weight:800;color:#bfe3ff;line-height:1.1}
        .lg-jdesc{font-size:12.5px;opacity:.9;line-height:1.3;margin-top:2px}

        .lg-slide{flex:1;position:relative;border-radius:18px;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.3);min-height:340px;background:rgba(255,255,255,.06)}
        .lg-slide-layer{position:absolute;inset:0;transition:opacity .8s ease}
        .lg-slide-img{width:100%;height:100%;object-fit:cover;display:block}
        .lg-slide-fb{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:800;color:rgba(255,255,255,.85);background:linear-gradient(135deg,rgba(255,255,255,.2),rgba(255,255,255,.05))}
        .lg-slide-cap{position:absolute;left:0;right:0;bottom:0;padding:40px 20px 16px;background:linear-gradient(to top,rgba(6,14,34,.82),rgba(6,14,34,0));z-index:2}
        .lg-slide-cap .y{font-size:22px;font-weight:800;color:#fff;line-height:1}
        .lg-slide-cap .d{font-size:13.5px;color:#e6eefc;margin-top:4px}
        .lg-dots{position:absolute;top:14px;right:14px;display:flex;gap:6px;z-index:2}
        .lg-dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.45);cursor:pointer;transition:background .2s,width .2s}
        .lg-dot.on{background:#fff;width:20px;border-radius:5px}
        .lg-copy{font-size:11.5px;opacity:.6;margin-top:16px}

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
        @media(max-width:1100px){ .lg-slide{min-height:280px} .lg-tl{width:250px} }
        @media(max-width:900px){
          .lg-left{display:none}
          .lg-right{flex:1;overflow-y:auto}
          .lg-mobilebrand{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:24px}
          .lg-mobilebrand img{width:38px;height:38px;object-fit:contain}
          .lg-mobilebrand b{font-size:20px;font-weight:800;color:#003c84}
        }
        @media(max-height:760px){ .lg-left-inner{padding:24px 52px} .lg-slide{min-height:300px} .lg-h1{font-size:22px} }
      `}</style>

      {/* CỘT TRÁI — thương hiệu + hành trình dạng slide */}
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
          <div className="lg-body">
            {/* Timeline bấm chọn */}
            <div className="lg-tl">
              {JOURNEY.map((j, i) => (
                <div key={j.year} className={`lg-tlrow${i === active ? " on" : ""}`} onClick={() => pick(i)}>
                  <Thumb year={j.year} />
                  <div>
                    <div className="lg-jyear">{j.year}</div>
                    <div className="lg-jdesc">{j.title}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* Slide ảnh lớn tự chạy */}
            <div className="lg-slide">
              {JOURNEY.map((j, i) => <SlideLayer key={j.year} year={j.year} on={i === active} />)}
              <div className="lg-dots">
                {JOURNEY.map((j, i) => <span key={j.year} className={`lg-dot${i === active ? " on" : ""}`} onClick={() => pick(i)} />)}
              </div>
              <div className="lg-slide-cap">
                <div className="y">{JOURNEY[active].year}</div>
                <div className="d">{JOURNEY[active].title}</div>
              </div>
            </div>
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
