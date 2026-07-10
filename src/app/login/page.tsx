"use client";
import { useState } from "react";

const VALUES = [
  { icon: "🌱", title: "Mỗi cá nhân đều quan trọng", desc: "Không có vị trí nào là nhỏ bé — chỉ có những đóng góp chưa được nhìn thấy. Chúng tôi cam kết ghi nhận, trân trọng và tưởng thưởng xứng đáng cho mọi nỗ lực." },
  { icon: "🚀", title: "Cơ hội cho người thực sự có năng lực", desc: "Ở đây, không quan trọng bạn đến từ đâu, bao nhiêu tuổi hay học trường nào — chỉ cần bạn dám nghĩ, dám làm và dám chịu trách nhiệm. Hành trình thăng tiến của bạn do chính bạn quyết định." },
  { icon: "💡", title: "Học hỏi là một phần của công việc", desc: "Thế giới TMĐT thay đổi mỗi ngày. Chúng tôi khuyến khích thử nghiệm, chấp nhận sai lầm và xem mỗi thất bại là một bài học để tiến xa hơn." },
  { icon: "🤝", title: "Chuyên nghiệp nhưng gần gũi", desc: "Chúng tôi làm việc nghiêm túc với deadline, KPI và mục tiêu rõ ràng — nhưng cũng không quên những bữa trưa cùng nhau, những buổi team building đáng nhớ và một văn hóa \"sếp cũng là đồng đội\"." },
];

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
        .lg-root{position:fixed;inset:0;display:flex;background:#fff;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
        .lg-left{flex:1.05;position:relative;overflow-y:auto;color:#fff;
          background:linear-gradient(150deg,#003c84 0%,#0a3f8f 42%,#3b2f8f 78%,#5b2f8f 100%)}
        .lg-left-inner{padding:52px 56px 40px;max-width:640px}
        .lg-right{flex:.95;display:flex;align-items:center;justify-content:center;padding:32px;overflow-y:auto}
        .lg-form{width:100%;max-width:400px}
        .lg-brand{display:flex;align-items:center;gap:12px;margin-bottom:6px}
        .lg-brand-chip{width:52px;height:52px;border-radius:14px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.18);flex-shrink:0}
        .lg-brand-chip img{width:34px;height:34px;object-fit:contain}
        .lg-brand-name{font-size:22px;font-weight:800;letter-spacing:.5px;line-height:1}
        .lg-brand-tag{font-size:11.5px;opacity:.8;margin-top:3px}
        .lg-sub{font-size:12.5px;letter-spacing:2px;text-transform:uppercase;opacity:.7;margin:26px 0 10px;font-weight:700}
        .lg-h1{font-size:30px;font-weight:800;line-height:1.15;margin-bottom:20px}
        .lg-p{font-size:14px;line-height:1.7;opacity:.9;margin-bottom:14px}
        .lg-p b{font-weight:700;color:#bfe3ff}
        .lg-hr{height:1px;background:rgba(255,255,255,.18);margin:22px 0}
        .lg-believe{font-weight:700;font-size:15px;margin-bottom:16px}
        .lg-val{display:flex;gap:14px;margin-bottom:16px}
        .lg-val-ic{width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.13);display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0}
        .lg-val-t{font-weight:700;font-size:14px;margin-bottom:3px}
        .lg-val-d{font-size:12.5px;line-height:1.6;opacity:.82}
        .lg-close{font-weight:800;font-size:17px;line-height:1.4;margin:8px 0 12px}
        .lg-fine{font-size:12px;line-height:1.6;opacity:.72}
        .lg-copy{font-size:11.5px;opacity:.6;margin-top:22px}
        .lg-ftitle{font-size:26px;font-weight:800;margin-bottom:4px}
        .lg-fsub{color:var(--muted,#4a5a6a);font-size:13.5px;margin-bottom:26px}
        .lg-fsub a{color:#003c84;font-weight:700}
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
        .lg-btn:hover{opacity:.93}
        .lg-btn:active{transform:translateY(1px)}
        .lg-btn:disabled{opacity:.6;cursor:default}
        .lg-err{color:#ef4444;font-weight:700;font-size:12.5px;margin-top:12px}
        .lg-terms{text-align:center;font-size:12px;color:#8595a5;margin-top:16px;line-height:1.6}
        .lg-terms b{color:#33445a;font-weight:700}
        .lg-dev{text-align:center;font-size:12.5px;color:#4a5a6a;margin-top:20px;padding-top:16px;border-top:1px solid #eef1f4}
        .lg-dev b{color:#003c84}
        .lg-mobilebrand{display:none}
        @media(max-width:880px){
          .lg-left{display:none}
          .lg-right{flex:1}
          .lg-mobilebrand{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:24px}
          .lg-mobilebrand img{width:38px;height:38px;object-fit:contain}
          .lg-mobilebrand b{font-size:20px;font-weight:800;color:#003c84}
        }
      `}</style>

      {/* CỘT TRÁI — thương hiệu & văn hóa */}
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

          <p className="lg-p">Fusion là công ty <b>Print-on-Demand &amp; Thương mại điện tử xuyên biên giới</b>, mang những sản phẩm sáng tạo của người Việt đến với khách hàng trên khắp thế giới.</p>
          <p className="lg-p">Chúng tôi phục vụ hàng triệu khách hàng tại <b>Mỹ và Châu Âu</b>, thông qua các nền tảng lớn nhất thế giới: <b>Amazon, TikTok, Etsy và Shopify</b>.</p>

          <div className="lg-hr" />
          <div className="lg-believe">Tại FUSION, chúng tôi tin rằng:</div>
          {VALUES.map((v) => (
            <div className="lg-val" key={v.title}>
              <div className="lg-val-ic">{v.icon}</div>
              <div>
                <div className="lg-val-t">{v.title}</div>
                <div className="lg-val-d">{v.desc}</div>
              </div>
            </div>
          ))}

          <div className="lg-hr" />
          <div className="lg-close">Nếu bạn là người trẻ, năng động và đang tìm một nơi để phát triển bản thân — chào mừng về nhà.</div>
          <div className="lg-fine">Hệ thống quản lý nội bộ này được xây dựng để đồng hành cùng bạn trong từng ngày làm việc — từ quản lý đơn hàng, thiết kế, đến theo dõi hiệu suất và phát triển sự nghiệp tại FUSION.</div>
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
