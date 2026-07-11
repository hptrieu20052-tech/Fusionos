"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/components/lang-provider";

export type RangeValue = { range: string; from?: string; to?: string };

const MONTHS = ["Th 1", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7", "Th 8", "Th 9", "Th 10", "Th 11", "Th 12"];
const PRESETS: [string, string][] = [
  ["today", "dr.today"], ["yesterday", "dr.yesterday"], ["7d", "dr.7d"], ["30d", "dr.30d"],
  ["this_month", "dr.thisMonth"], ["last_month", "dr.lastMonth"], ["this_year", "dr.thisYear"],
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const disp = (s: string) => { const [y, m, d] = s.split("-"); return `${d}-${m}-${y}`; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const som = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const matrix = (y: number, m: number) => { const f = new Date(y, m, 1); const s = addDays(f, -f.getDay()); return Array.from({ length: 42 }, (_, i) => addDays(s, i)); };

/** Đổi preset → {from,to} cụ thể (cho API chỉ nhận ngày) */
export function rangeToDates(v: RangeValue): { from: string; to: string } {
  const now = new Date(); const today = iso(now);
  const back = (n: number) => iso(addDays(now, -n));
  switch (v.range) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: back(1), to: back(1) };
    case "3d": return { from: back(2), to: today };
    case "7d": return { from: back(6), to: today };
    case "30d": return { from: back(29), to: today };
    case "this_month": return { from: iso(som(now)), to: today };
    case "last_month": return { from: iso(addMonths(som(now), -1)), to: iso(addDays(som(now), -1)) };
    case "this_year": return { from: `${now.getFullYear()}-01-01`, to: today };
    default: return { from: v.from ?? back(29), to: v.to ?? today };
  }
}

export default function DateRangePicker({ value, onChange, align = "left", allowClear = false, onClear }: {
  value: RangeValue; onChange: (v: RangeValue) => void; align?: "left" | "right";
  allowClear?: boolean; onClear?: () => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<{ start: string; end: string }>({ start: value.from ?? "", end: value.to ?? "" });
  const [base, setBase] = useState(() => som(value.to ? parseISO(value.to) : new Date()));
  const ref = useRef<HTMLDivElement>(null);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const clickDay = (d: Date) => {
    if (d > today) return;
    const ds = iso(d);
    if (!pick.start || (pick.start && pick.end) || parseISO(ds) < parseISO(pick.start)) {
      setPick({ start: ds, end: "" });
    } else {
      setPick({ start: pick.start, end: ds });
      onChange({ range: "custom", from: pick.start, to: ds });
      setOpen(false);
    }
  };
  const inRange = (d: Date) => {
    if (!pick.start) return false;
    const s = parseISO(pick.start), e = pick.end ? parseISO(pick.end) : s;
    return d >= s && d <= e;
  };
  const isEnd = (d: Date) => { const ds = iso(d); return ds === pick.start || ds === pick.end; };

  const Month = ({ md }: { md: Date }) => (
    <div className="dp-month">
      <div className="dp-mhead">{MONTHS[md.getMonth()]} {md.getFullYear()}</div>
      <div className="dp-grid">
        {matrix(md.getFullYear(), md.getMonth()).map((d, i) => {
          const out = d.getMonth() !== md.getMonth();
          const fut = d > today;
          return (
            <button key={i} type="button" disabled={out || fut}
              className={`dp-day${out ? " out" : ""}${fut ? " fut" : ""}${inRange(d) && !out ? " range" : ""}${isEnd(d) && !out ? " sel" : ""}`}
              onClick={() => clickDay(d)}>{d.getDate()}</button>
          );
        })}
      </div>
    </div>
  );

  const preset = PRESETS.find(([k]) => k === value.range);
  const label = preset ? t(preset[1])
    : value.range === "custom" && value.from && value.to ? `${disp(value.from)} → ${disp(value.to)}`
    : t("dr.allTime");

  return (
    <div className="dp" ref={ref}>
      <button type="button" className="dp-trigger" onClick={() => setOpen((v) => !v)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        {label}
        <span style={{ fontSize: 10, color: "var(--faint)" }}>▾</span>
      </button>
      {open && (
        <div className={`dp-pop${align === "right" ? " right" : ""}`}>
          <div className="dp-presets">
            {PRESETS.map(([k, l]) => (
              <button key={k} className={value.range === k ? "on" : ""} onClick={() => {
                onChange({ range: k });
                const d = rangeToDates({ range: k });
                setPick({ start: d.from, end: d.to });
                setBase(som(parseISO(d.to)));
                setOpen(false);
              }}>{t(l)}</button>
            ))}
            {allowClear && <button className="dp-clear" onClick={() => { onClear?.(); setOpen(false); }}>{t("c.clearFilter")}</button>}
          </div>
          <div className="dp-cals">
            <button type="button" className="dp-nav prev" onClick={() => setBase((b) => addMonths(b, -1))}>‹</button>
            <Month md={base} />
            <Month md={addMonths(base, 1)} />
            <button type="button" className="dp-nav next" onClick={() => setBase((b) => addMonths(b, 1))}>›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== DateInput: chọn MỘT ngày, cùng phong cách dp — dùng cho Admin HR (start date / birthday) =====
const M_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function DateInput({ value, onChange, placeholder = "Pick date", width = 150 }: {
  value: string | null | undefined; onChange: (v: string) => void; placeholder?: string; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState(() => som(value ? parseISO(value) : new Date()));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  useEffect(() => { if (value) setBase(som(parseISO(value))); }, [value]);
  return (
    <div className="dp" ref={ref} style={{ display: "inline-block" }}>
      <button type="button" className="dp-trigger" style={{ minWidth: width, justifyContent: "flex-start" }} onClick={() => setOpen((v) => !v)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        {value ? disp(value) : <span style={{ color: "var(--muted)", fontWeight: 500 }}>{placeholder}</span>}
      </button>
      {open && (
        <div className="dp-pop" style={{ minWidth: 258, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, position: "relative", height: 30, marginBottom: 4 }}>
            <button type="button" className="dp-nav" style={{ position: "static" }} title="Prev year" onClick={() => setBase((b) => addMonths(b, -12))}>«</button>
            <button type="button" className="dp-nav" style={{ position: "static" }} onClick={() => setBase((b) => addMonths(b, -1))}>‹</button>
            <b style={{ fontSize: 12.5, minWidth: 78, textAlign: "center" }}>{M_EN[base.getMonth()]} {base.getFullYear()}</b>
            <button type="button" className="dp-nav" style={{ position: "static" }} onClick={() => setBase((b) => addMonths(b, 1))}>›</button>
            <button type="button" className="dp-nav" style={{ position: "static" }} title="Next year" onClick={() => setBase((b) => addMonths(b, 12))}>»</button>
          </div>
          <div className="dp-grid">
            {matrix(base.getFullYear(), base.getMonth()).map((d, i) => {
              const out = d.getMonth() !== base.getMonth();
              const sel = value === iso(d);
              return (
                <button key={i} type="button" disabled={out}
                  className={`dp-day${out ? " out" : ""}${sel ? " sel" : ""}`}
                  onClick={() => { onChange(iso(d)); setOpen(false); }}>{d.getDate()}</button>
              );
            })}
          </div>
          {value ? <button type="button" onClick={() => { onChange(""); setOpen(false); }} style={{ marginTop: 8, width: "100%", border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "5px 0", fontSize: 12, cursor: "pointer", color: "var(--muted)", fontWeight: 600 }}>Clear</button> : null}
        </div>
      )}
    </div>
  );
}
