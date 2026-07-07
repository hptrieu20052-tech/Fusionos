"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/components/lang-provider";

type Issue = { id: string; reason: string; createdAt: string; externalId: string; orderId: string; supplier: string; supplierId: string | null; reporter: string; imageUrl: string | null };
type Report = { supplier: string; count: number };

const fmt = (s: string) => new Date(s).toISOString().slice(0, 16).replace("T", " ");

export default function SupplierReportClient() {
  const { t } = useLang();
  const [data, setData] = useState<{ issues: Issue[]; report: Report[]; total: number } | null>(null);
  const [supplier, setSupplier] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => { fetch("/api/order-issues").then((r) => r.json()).then((j) => { if (j.ok) setData(j); }); }, []);
  if (!data) return <div className="panel empty">…</div>;

  const maxCount = Math.max(1, ...data.report.map((r) => r.count));
  const issues = supplier ? data.issues.filter((i) => i.supplier === supplier) : data.issues;

  return (
    <>
      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(16,20,28,.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, cursor: "zoom-out" }}>
          <img src={zoom} alt="" style={{ maxWidth: "92vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 12 }} />
        </div>
      )}

      <h2 style={{ fontSize: 20, fontWeight: 800, margin: "6px 0 2px" }}>{t("iss.report")}</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>{t("iss.totalIssues")}: <b style={{ color: "var(--ink)" }}>{data.total}</b></div>

      {/* Tổng hợp theo supplier */}
      <div className="panel">
        <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>{t("iss.bySupplier")}</h3>
        {data.report.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("iss.noIssues")}</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.report.map((r) => (
              <div key={r.supplier} onClick={() => setSupplier(supplier === r.supplier ? "" : r.supplier)}
                style={{ display: "grid", gridTemplateColumns: "180px 1fr 60px", gap: 12, alignItems: "center", cursor: "pointer", padding: "4px 6px", borderRadius: 8, background: supplier === r.supplier ? "var(--blue-soft)" : "transparent" }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.supplier}</span>
                <span style={{ height: 22, background: "#EEF1F6", borderRadius: 6, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${(r.count / maxCount) * 100}%`, background: "var(--red)", borderRadius: 6, minWidth: 4 }} />
                </span>
                <b style={{ fontSize: 14, textAlign: "right", color: "var(--red)" }}>{r.count}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Đơn lỗi gần đây */}
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800 }}>{t("iss.recent")}{supplier ? ` — ${supplier}` : ""}</h3>
          {supplier && <button onClick={() => setSupplier("")} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 9, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" }}>✕ {t("c.all")}</button>}
        </div>
        {issues.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13 }}>{t("iss.noIssues")}</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
            {issues.map((i) => (
              <div key={i.id} style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {i.imageUrl ? (
                  <div className="checker" onClick={() => setZoom(i.imageUrl)} style={{ aspectRatio: "16/10", cursor: "zoom-in" }}>
                    <img src={i.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  </div>
                ) : <div className="checker" style={{ aspectRatio: "16/10", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12 }}>—</div>}
                <div style={{ padding: "11px 13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <a href={`/orders?q=${i.externalId}`} style={{ fontSize: 12.5, fontWeight: 800, color: "var(--blue)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{i.externalId}</a>
                    <span className="chip" style={{ background: "#2A303C", color: "#fff", fontSize: 10.5 }}>{i.supplier}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 7, lineHeight: 1.5 }}>{i.reason}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, display: "flex", justifyContent: "space-between" }}>
                    <span>{t("iss.reporter")}: {i.reporter}</span>
                    <span>{fmt(i.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
