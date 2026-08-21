"use client";

import { useMemo, useState } from "react";

export type Pattern = {
  sig: string;
  count: number;
  fields: { type: "text" | "dropdown" | "upload"; label: string; detail: string; required: boolean }[];
  samples: { sku: string; title: string }[];
  productIds: string[];
  productTypes: Record<string, number>;
};


// Bộ 6 field chuẩn (template dùng chung) — dùng để đánh dấu pattern nào KHỚP chuẩn.
// So khớp mềm theo (type + số lượng từng loại) để không phụ thuộc chính tả nhãn.
const STANDARD = { text: 4, upload: 1, dropdown: 1 };

function typeCounts(p: Pattern): Record<string, number> {
  const c: Record<string, number> = { text: 0, upload: 0, dropdown: 0 };
  for (const f of p.fields) c[f.type] = (c[f.type] ?? 0) + 1;
  return c;
}
function matchesStandard(p: Pattern): boolean {
  const c = typeCounts(p);
  // Khớp nếu ≤ chuẩn ở mọi loại và có ≥1 text (sách nào cũng ít nhất có tên)
  return c.text >= 1 && c.text <= STANDARD.text && c.upload <= STANDARD.upload && c.dropdown <= STANDARD.dropdown;
}

const TYPE_COLOR: Record<string, string> = { text: "#2563eb", dropdown: "#7c3aed", upload: "#059669" };

export default function AmazonExportClient({
  patterns, totalProducts, noCustomCount,
}: { patterns: Pattern[]; totalProducts: number; noCustomCount: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string>("");

  const stats = useMemo(() => {
    const fit = patterns.filter(matchesStandard);
    const outlier = patterns.filter((p) => !matchesStandard(p));
    const fitProducts = fit.reduce((s, p) => s + p.count, 0);
    const outlierProducts = outlier.reduce((s, p) => s + p.count, 0);
    return { fit, outlier, fitProducts, outlierProducts };
  }, [patterns]);

  const copyIds = (sig: string, ids: string[]) => {
    navigator.clipboard?.writeText(ids.join("\n")).then(() => {
      setCopied(sig); setTimeout(() => setCopied(""), 1500);
    }).catch(() => {});
  };

  const card = (p: Pattern, idx: number) => {
    const fit = matchesStandard(p);
    const isOpen = !!open[p.sig];
    return (
      <div key={p.sig} style={{
        border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 12,
        background: "#fff", borderLeft: `4px solid ${fit ? "#059669" : "#f59e0b"}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Pattern #{idx + 1}
              <span style={{
                marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                background: fit ? "#dcfce7" : "#fef3c7", color: fit ? "#166534" : "#92400e",
              }}>{fit ? "Fits standard template" : "Outlier — handle separately"}</span>
            </div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
              {p.count} product{p.count > 1 ? "s" : ""} · {p.fields.length} field{p.fields.length > 1 ? "s" : ""}
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: fit ? "#059669" : "#f59e0b" }}>{p.count}</div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {p.fields.map((f, i) => (
            <span key={i} style={{
              fontSize: 12, padding: "4px 10px", borderRadius: 8, background: "#f9fafb", border: "1px solid #eef0f2",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLOR[f.type] }} />
              <b style={{ fontWeight: 600 }}>{f.label || "(no label)"}</b>
              <span style={{ color: "#9ca3af" }}>· {f.detail}{f.required ? " · required" : ""}</span>
            </span>
          ))}
        </div>

        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 10 }}>
          Product types: {Object.entries(p.productTypes).map(([k, v]) => `${k} (${v})`).join(", ")}
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setOpen((o) => ({ ...o, [p.sig]: !o[p.sig] }))} style={btnStyle}>
            {isOpen ? "Hide" : "Show"} samples
          </button>
          <button onClick={() => copyIds(p.sig, p.productIds)} style={btnStyle}>
            {copied === p.sig ? "Copied!" : `Copy ${p.productIds.length} product IDs`}
          </button>
        </div>

        {isOpen && (
          <div style={{ marginTop: 10, borderTop: "1px dashed #e5e7eb", paddingTop: 10 }}>
            {p.samples.map((s, i) => (
              <div key={i} style={{ fontSize: 13, padding: "3px 0", display: "flex", gap: 8 }}>
                <code style={{ color: "#2563eb", minWidth: 130 }}>{s.sku || "—"}</code>
                <span style={{ color: "#374151" }}>{s.title}</span>
              </div>
            ))}
            {p.count > p.samples.length && (
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>… and {p.count - p.samples.length} more</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 16px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>Amazon Custom — Pattern Report</h1>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px" }}>
        Groups all Shopify products by their personalization structure. Products with the same structure can share one
        Amazon Custom template. Green = fits your standard shared template · Amber = outlier to handle separately.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        {[
          { label: "Total products", value: totalProducts, color: "#111827" },
          { label: "Distinct patterns", value: patterns.length, color: "#2563eb" },
          { label: "Fit standard", value: `${stats.fit.length} patterns · ${stats.fitProducts} products`, color: "#059669" },
          { label: "Outliers", value: `${stats.outlier.length} patterns · ${stats.outlierProducts} products`, color: "#f59e0b" },
          { label: "No customization", value: noCustomCount, color: "#6b7280" },
        ].map((s, i) => (
          <div key={i} style={{
            flex: "1 1 160px", border: "1px solid #e5e7eb", borderRadius: 12, padding: "12px 16px", background: "#fff",
          }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {patterns.length === 0 ? (
        <div className="panel empty">No products with customization found.</div>
      ) : (
        <>
          {stats.outlier.length > 0 && (
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "8px 0 10px", color: "#92400e" }}>
              ⚠ Outliers — {stats.outlierProducts} products need a different template
            </h2>
          )}
          {stats.outlier.map((p, i) => card(p, i))}

          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "20px 0 10px", color: "#166534" }}>
            ✓ Fit the standard template — {stats.fitProducts} products
          </h2>
          {stats.fit.map((p, i) => card(p, i))}
        </>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #d1d5db",
  background: "#fff", cursor: "pointer", color: "#374151",
};
