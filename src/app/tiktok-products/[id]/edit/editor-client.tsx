"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Sku = { sellerSku: string; variant: string; price: string; currency: string; quantity: number };
type Summary = {
  title: string; description: string; status: string;
  categoryId: string | null; categoryName: string | null; brand: string | null;
  images: string[];
  packageWeight: { value: string; unit: string } | null;
  packageDimensions: { length: string; width: string; height: string; unit: string } | null;
  attributes: { name: string; values: string[] }[];
  skus: Sku[];
};

const toGram = (v: string, unit: string) => {
  const n = Number(v); if (!n) return "";
  if (unit === "KILOGRAM") return String(n * 1000);
  if (unit === "POUND") return String(Math.round(n * 453.592));
  if (unit === "OUNCE") return String(Math.round(n * 28.3495));
  return String(n); // GRAM
};
const toCm = (v: string, unit: string) => {
  const n = Number(v); if (!n) return "";
  return unit === "INCH" ? String(+(n * 2.54).toFixed(2)) : String(n); // CENTIMETER
};

const lab: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--muted)", margin: "0 0 6px" };
const fld: React.CSSProperties = { width: "100%", padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13.5, boxSizing: "border-box" };
const sec: React.CSSProperties = { marginBottom: 18 };

export default function EditorClient({ id, mode }: { id: string; mode: "edit" | "clone" }) {
  const router = useRouter();
  const [sum, setSum] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("");
  const [dim, setDim] = useState({ length: "", width: "", height: "" });
  const [saveMode, setSaveMode] = useState<"LISTING" | "AS_DRAFT">(mode === "clone" ? "AS_DRAFT" : "LISTING");
  const [skus, setSkus] = useState<{ variant: string; price: string; quantity: string; sellerSku: string }[]>([]);
  const [basePrice, setBasePrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState("");

  useEffect(() => {
    fetch(`/api/tiktok/products/${id}/detail`).then((r) => r.json()).then((j) => {
      if (!j.ok) { setErr(j.error || "Không tải được product"); setLoading(false); return; }
      const s: Summary = j.summary;
      setSum(s);
      setTitle(mode === "clone" ? `${s.title} (Copy)` : s.title);
      setDescription(s.description || "");
      setWeight(s.packageWeight ? toGram(s.packageWeight.value, s.packageWeight.unit) : "");
      setDim({
        length: s.packageDimensions ? toCm(s.packageDimensions.length, s.packageDimensions.unit) : "",
        width: s.packageDimensions ? toCm(s.packageDimensions.width, s.packageDimensions.unit) : "",
        height: s.packageDimensions ? toCm(s.packageDimensions.height, s.packageDimensions.unit) : "",
      });
      setSkus(s.skus.map((k) => ({ variant: k.variant, price: String(k.price || ""), quantity: String(k.quantity ?? ""), sellerSku: k.sellerSku || "" })));
      setLoading(false);
    }).catch((e) => { setErr(String(e)); setLoading(false); });
  }, [id, mode]);

  const setSku = (i: number, patch: Partial<{ price: string; quantity: string; sellerSku: string }>) =>
    setSkus((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const applyBase = () => { if (basePrice) setSkus((prev) => prev.map((s) => ({ ...s, price: basePrice }))); };

  const payload = (dryRun: boolean) => ({
    dryRun,
    title, description, saveMode,
    packageWeightGram: weight || undefined,
    packageDim: (dim.length || dim.width || dim.height) ? dim : undefined,
    skus: skus.map((s) => ({ price: s.price || undefined, quantity: s.quantity !== "" ? Number(s.quantity) : undefined, sellerSku: s.sellerSku || undefined })),
  });
  const endpoint = mode === "clone" ? `/api/tiktok/products/${id}/clone` : `/api/tiktok/products/${id}/edit`;

  const call = async (dryRun: boolean) => {
    setBusy(true); setMsg(dryRun ? "Đang dựng body…" : mode === "clone" ? "Đang tạo bản clone trên TikTok…" : "Đang cập nhật trên TikTok…"); setPreview("");
    try {
      const j = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(dryRun)) }).then((r) => r.json());
      if (!j.ok) { setMsg("✗ " + (j.error || "Thất bại")); }
      else if (j.dryRun) { setPreview(JSON.stringify(j.body, null, 2)); setMsg("Body sẽ gửi lên TikTok (xem dưới). Chưa tạo gì cả."); }
      else if (mode === "clone") { setMsg(`✓ Đã tạo product mới${j.productId ? ` (id ${j.productId})` : ""}. Bấm Sync để thấy trong bảng.`); }
      else { setMsg("✓ Đã cập nhật product trên TikTok."); }
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  if (loading) return <div className="panel empty" style={{ padding: 40 }}>Đang tải product…</div>;
  if (err) return <div className="panel empty" style={{ padding: 40, color: "var(--red)" }}>✗ {err}</div>;

  return (
    <div className="panel" style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{mode === "clone" ? "Clone product · TikTok Shop" : "Edit product · TikTok Shop"}</h2>
        <button onClick={() => router.push("/tiktok-products")} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 13px", fontSize: 13, cursor: "pointer" }}>← Quay lại</button>
      </div>

      <div style={sec}>
        <label style={lab}>Name (*)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={fld} />
      </div>

      <div style={sec}>
        <label style={lab}>Category</label>
        <div style={{ ...fld, background: "#F6F8FB", color: "var(--muted)" }}>{sum?.categoryName ?? "—"}{sum?.brand ? ` · Brand: ${sum.brand}` : ""}</div>
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>Đổi category + attributes ở bản kế (giữ nguyên của product gốc).</div>
      </div>

      <div style={sec}>
        <label style={lab}>Description (*)</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} style={{ ...fld, fontFamily: "inherit", resize: "vertical" }} />
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>Chấp nhận HTML. (Rich-text editor sẽ thêm sau.)</div>
      </div>

      <div style={{ ...sec, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px" }}>
          <label style={lab}>Package Weight (Gram) (*)</label>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" style={fld} />
        </div>
        <div style={{ flex: "2 1 320px" }}>
          <label style={lab}>Package Size (cm) — L × W × H (*)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="L" value={dim.length} onChange={(e) => setDim({ ...dim, length: e.target.value })} style={fld} />
            <input placeholder="W" value={dim.width} onChange={(e) => setDim({ ...dim, width: e.target.value })} style={fld} />
            <input placeholder="H" value={dim.height} onChange={(e) => setDim({ ...dim, height: e.target.value })} style={fld} />
          </div>
        </div>
      </div>

      <div style={sec}>
        <label style={lab}>Publish</label>
        <div style={{ display: "flex", gap: 16, fontSize: 13.5 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={saveMode === "LISTING"} onChange={() => setSaveMode("LISTING")} /> Đăng bán (LISTING)
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" checked={saveMode === "AS_DRAFT"} onChange={() => setSaveMode("AS_DRAFT")} /> Lưu nháp (DRAFT)
          </label>
        </div>
      </div>

      <div style={sec}>
        <label style={lab}>Base Price (điền nhanh cho mọi variant)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={basePrice} onChange={(e) => setBasePrice(e.target.value)} inputMode="decimal" placeholder="vd 25.99" style={{ ...fld, maxWidth: 200 }} />
          <button onClick={applyBase} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "0 14px", fontSize: 13, cursor: "pointer", background: "#fff" }}>Áp cho tất cả</button>
        </div>
      </div>

      <div style={sec}>
        <label style={lab}>Variants — giá / tồn / SKU</label>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
                <th style={{ padding: "6px 6px" }}>Variant</th><th style={{ padding: "6px 6px", width: 120 }}>Price</th><th style={{ padding: "6px 6px", width: 110 }}>Qty</th><th style={{ padding: "6px 6px", width: 200 }}>Seller SKU</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 6px" }}>{s.variant || "(default)"}</td>
                  <td style={{ padding: "6px 6px" }}><input value={s.price} onChange={(e) => setSku(i, { price: e.target.value })} inputMode="decimal" style={{ ...fld, padding: "6px 8px" }} /></td>
                  <td style={{ padding: "6px 6px" }}><input value={s.quantity} onChange={(e) => setSku(i, { quantity: e.target.value })} inputMode="numeric" style={{ ...fld, padding: "6px 8px" }} /></td>
                  <td style={{ padding: "6px 6px" }}><input value={s.sellerSku} onChange={(e) => setSku(i, { sellerSku: e.target.value })} style={{ ...fld, padding: "6px 8px" }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sum && sum.images.length > 0 && (
        <div style={sec}>
          <label style={lab}>Ảnh (giữ nguyên — đổi/upload ở bản kế)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {sum.images.map((u, i) => <img key={i} src={u} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />)}
          </div>
        </div>
      )}

      {sum && sum.attributes.length > 0 && (
        <div style={sec}>
          <label style={lab}>Attributes (giữ nguyên)</label>
          <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.7 }}>
            {sum.attributes.map((a, i) => <div key={i}><b style={{ color: "var(--ink)" }}>{a.name}:</b> {a.values.join(", ") || "—"}</div>)}
          </div>
        </div>
      )}

      {msg && <div style={{ fontSize: 13, margin: "6px 0 12px", color: msg.startsWith("✗") ? "var(--red)" : "var(--green)" }}>{msg}</div>}
      {preview && <pre style={{ background: "#0E1726", color: "#CFE3FF", padding: 14, borderRadius: 10, fontSize: 11.5, overflow: "auto", maxHeight: 320 }}>{preview}</pre>}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={() => call(false)} disabled={busy} style={{ background: mode === "clone" ? "var(--green)" : "var(--blue)", color: "#fff", border: 0, borderRadius: 9, padding: "10px 20px", fontWeight: 800, fontSize: 14, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {mode === "clone" ? "Tạo bản clone" : "Cập nhật lên TikTok"}
        </button>
        <button onClick={() => call(true)} disabled={busy} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 16px", fontWeight: 700, fontSize: 13, cursor: busy ? "default" : "pointer" }}>
          Xem body (không đẩy)
        </button>
        <button onClick={() => router.push("/tiktok-products")} disabled={busy} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>Hủy</button>
      </div>
    </div>
  );
}
