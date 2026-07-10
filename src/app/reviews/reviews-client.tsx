"use client";
import { useLang } from "@/components/lang-provider";
import { useEffect, useState } from "react";

type D = { id: string; sku_code: number; title: string; points: number; designer: string | null; thumb: string | null; biz_items: number; reviewed: number };
const inp = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 10, font: "inherit", fontSize: 12.5, width: 64, textAlign: "center" as const };

export function ReviewsClient({ canReview }: { canReview: boolean }) {
  const { t } = useLang();
  const [designs, setDesigns] = useState<D[]>([]);
  const [sel, setSel] = useState<D | null>(null);
  const [scores, setScores] = useState({ scoreBrief: 8, scoreAesthetic: 8, scoreTechnical: 8 });
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");

  const load = () => fetch("/api/reviews").then((r) => r.json()).then((j) => j.ok && setDesigns(j.designs));
  useEffect(() => { load(); }, []);

  const quality = ((scores.scoreBrief + scores.scoreAesthetic + scores.scoreTechnical) / 3);

  async function submit(decision: string) {
    if (!sel) return;
    setMsg(t("rev.saving"));
    const j = await fetch("/api/reviews", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designId: sel.id, ...scores, comment, decision }),
    }).then((r) => r.json());
    if (j.ok) {
      setMsg(t("rev.totalScore").replace("{total}", j.breakdown.total.toFixed(1)).replace("{q}", j.breakdown.quality.toFixed(1)).replace("{d}", j.breakdown.discipline.toFixed(1)).replace("{b}", j.breakdown.business.toFixed(1)).replace("{n}", String(j.breakdown.bizOrders)));
      setSel(null); load();
    } else setMsg("⚠ " + j.error);
  }

  const S = ({ k, label }: { k: keyof typeof scores; label: string }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, fontWeight: 700 }}>
      <span style={{ width: 150, color: "var(--muted)" }}>{label}</span>
      <input type="range" min={1} max={10} value={scores[k]} onChange={(e) => setScores({ ...scores, [k]: Number(e.target.value) })} style={{ flex: 1 }} />
      <input type="number" min={1} max={10} value={scores[k]} onChange={(e) => setScores({ ...scores, [k]: Number(e.target.value) })} style={inp} />
    </label>
  );

  return (
    <>
      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>{t("rev.scoreDesign")}</h3>
        <div className="sub">{t("rev.rubric")}</div>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th></th><th>Design</th><th>Designer</th><th style={{ textAlign: "center" }}>Difficulty</th><th style={{ textAlign: "center" }}>{t("rev.genItems")}</th><th style={{ textAlign: "center" }}>{t("rev.scored")}</th><th></th></tr></thead>
          <tbody>
            {designs.map((d) => (
              <tr key={d.id}>
                <td style={{ width: 52 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--blue-soft)", overflow: "hidden", display: "grid", placeItems: "center" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {d.thumb ? <img src={d.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : ""}
                  </div>
                </td>
                <td><b>{d.title}</b><div style={{ fontSize: 11, color: "var(--faint)" }}>#{d.sku_code}</div></td>
                <td>{d.designer ?? "—"}</td>
                <td style={{ textAlign: "center" }}><span className="chip">×{d.points}</span></td>
                <td style={{ textAlign: "center", fontWeight: 800 }}>{d.biz_items}</td>
                <td style={{ textAlign: "center" }}>{d.reviewed > 0 ? <span className="badge b-ship">{d.reviewed} time(s)</span> : <span className="badge b-issue">{t("rev.notYet")}</span>}</td>
                <td>{canReview && <button onClick={() => { setSel(d); setScores({ scoreBrief: 8, scoreAesthetic: 8, scoreTechnical: 8 }); setComment(""); setMsg(""); }}
                  style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "7px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>Score</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {msg && !sel && <div style={{ marginTop: 10, fontWeight: 700, fontSize: 12.5 }}>{msg}</div>}
      </div>

      {sel && (
        <div onClick={() => setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", zIndex: 95, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, width: "min(560px,95vw)", padding: "22px 24px" }}>
            <h3 style={{ fontWeight: 800 }}>Score: {sel.title} <span className="chip">×{sel.points}</span></h3>
            <div className="sub" style={{ marginBottom: 14 }}>Designer: {sel.designer ?? "—"} · 30% manual quality below, the other 70% is auto-computed</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <S k="scoreBrief" label={t("rev.matchBrief")} />
              <S k="scoreAesthetic" label={t("rev.aesthetic")} />
              <S k="scoreTechnical" label={t("rev.fileTech")} />
            </div>
            <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--blue-soft)", borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
              Quality score: {quality.toFixed(1)}/10 <span style={{ fontWeight: 600, color: "var(--muted)" }}>{t("rev.pct30")}</span>
            </div>
            <textarea placeholder={t("rev.commentPh")} value={comment} onChange={(e) => setComment(e.target.value)}
              style={{ width: "100%", marginTop: 12, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit", fontSize: 12.5, minHeight: 70 }} />
            {msg && <div style={{ marginTop: 8, fontWeight: 700, fontSize: 12.5 }}>{msg}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button onClick={() => submit("reject")} style={{ background: "var(--red-soft)", color: "var(--red)", border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 800, cursor: "pointer" }}>Reject</button>
              <button onClick={() => submit("request_fix")} style={{ background: "var(--amber-soft)", color: "var(--amber)", border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 800, cursor: "pointer" }}>{t("rev.needFix")}</button>
              <button onClick={() => submit("approve")} style={{ background: "var(--green)", color: "#fff", border: 0, borderRadius: 10, padding: "10px 20px", fontWeight: 800, cursor: "pointer" }}>✓ Approve</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
