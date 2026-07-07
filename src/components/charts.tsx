"use client";
// Bộ chart SVG dùng chung — style Clarity
export function BarChart({ labels, values, highlight = -1, avgLine = true, height = 220 }: {
  labels: string[]; values: number[]; highlight?: number; avgLine?: boolean; height?: number;
}) {
  const W = 640, H = height, top = 30, bottom = 28;
  const max = Math.max(...values, 1) * 1.15;
  const avg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const n = values.length, bw = Math.min(46, (W - 40) / n * 0.7), gap = (W - n * bw) / (n + 1);
  const y = (v: number) => H - bottom - (v / max) * (H - top - bottom);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#EDF0F7" />
      ))}
      {values.map((v, i) => {
        const x = gap + i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={y(v)} width={bw} height={H - bottom - y(v)} rx={7}
              fill={i === highlight || (highlight === -1 && i === n - 1) ? "#1D5FAE" : "#BBD4EE"} />
            <text x={x + bw / 2} y={y(v) - 7} textAnchor="middle" fontFamily="Plus Jakarta Sans" fontWeight={800} fontSize={11} fill="#111827">{Math.round(v).toLocaleString()}</text>
            <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontFamily="Plus Jakarta Sans" fontSize={10.5} fill="#9CA3AF">{labels[i]}</text>
          </g>
        );
      })}
      {avgLine && <line x1={0} x2={W} y1={y(avg)} y2={y(avg)} stroke="#93C5FD" strokeWidth={2} strokeDasharray="5 5" />}
    </svg>
  );
}

export function HBarList({ rows, unit = "" }: { rows: { label: string; value: number; color?: string; suffix?: string }[]; unit?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
          <div style={{ height: 14, borderRadius: 99, background: "#EDF0F7", overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", borderRadius: 99, background: r.color ?? "var(--blue)" }} />
          </div>
          <b style={{ fontSize: 12.5 }}>{r.suffix ?? `${r.value.toLocaleString()}${unit}`}</b>
        </div>
      ))}
    </div>
  );
}

export function Heat({ v, max }: { v: number; max: number }) {
  const a = max ? v / max : 0;
  return (
    <span style={{
      display: "inline-block", minWidth: 40, textAlign: "center", padding: "4px 0", borderRadius: 8,
      fontWeight: 800, fontSize: 12, background: `rgba(13,76,155,${(0.06 + a * 0.34).toFixed(2)})`,
      color: a > 0.62 ? "#fff" : "#1E3A8A",
    }}>{v}</span>
  );
}
