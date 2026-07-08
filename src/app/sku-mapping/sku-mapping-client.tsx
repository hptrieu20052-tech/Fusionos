"use client";
import { useEffect, useMemo, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";
import { useConfirm } from "@/components/confirm-provider";

type Ff = { id: string; name: string; method: string; credentials: string | null; shopId: string | null };
type Map = { id: string; internalSku: string; fulfillerId: string; fulfillerSku: string; fulfillerProduct: string | null; variant: string | null; baseCost: string; shipCost: string; active: boolean };

const inp = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, font: "inherit", fontSize: 12.5, width: "100%" } as const;
const money = (v: string | number) => `$${Number(v).toFixed(2)}`;

export function SkuMappingClient({ canEdit }: { canEdit: boolean }) {
  const confirm = useConfirm();
  const [ffs, setFfs] = useState<Ff[]>([]);
  const [maps, setMaps] = useState<Map[]>([]);
  const [active, setActive] = useState<string>("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [editRow, setEditRow] = useState<Record<string, Partial<Map>>>({});
  const [nm, setNm] = useState({ internalSku: "", fulfillerSku: "", variant: "", baseCost: "", shipCost: "" });
  // Bộ chọn sản phẩm Printify
  type PP = { id: string; title: string; total: number; mappedCount: number; noSku: number };
  const [picker, setPicker] = useState<PP[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [diag, setDiag] = useState<{ shopId: string; rawCount: number } | null>(null);

  const load = () => fetch("/api/fulfillers").then((r) => r.json()).then((j) => {
    if (j.ok) { setFfs(j.fulfillers); setMaps(j.mappings); if (!active && j.fulfillers[0]) setActive(j.fulfillers[0].id); }
  });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const ff = ffs.find((f) => f.id === active);
  const rows = useMemo(() => maps.filter((m) => m.fulfillerId === active &&
    (!q || m.internalSku.toLowerCase().includes(q.toLowerCase()) || m.fulfillerSku.toLowerCase().includes(q.toLowerCase()) || (m.variant ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [maps, active, q]);
  const countBy = (id: string) => maps.filter((m) => m.fulfillerId === id).length;

  async function addMap() {
    if (!nm.internalSku || !nm.fulfillerSku || isNaN(Number(nm.baseCost))) { setMsg("⚠ Nhập đủ SKU nội bộ, SKU fulfiller, base cost"); return; }
    const j = await fetch("/api/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...nm, fulfillerId: active }) }).then((r) => r.json());
    setMsg(j.ok ? "✓ Đã thêm" : "⚠ " + j.error); if (j.ok) { setNm({ internalSku: "", fulfillerSku: "", variant: "", baseCost: "", shipCost: "" }); load(); }
  }
  async function saveRow(id: string) {
    const e = editRow[id]; if (!e) return;
    const j = await fetch("/api/mappings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...e }) }).then((r) => r.json());
    setMsg(j.ok ? "✓ Đã lưu" : "⚠ " + j.error); if (j.ok) { setEditRow((p) => { const n = { ...p }; delete n[id]; return n; }); load(); }
  }
  async function delRow(id: string) {
    if (!(await confirm({ message: "Xóa dòng mapping này?", danger: true }))) return;
    const j = await fetch("/api/mappings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((r) => r.json());
    if (j.ok) load();
  }
  async function openPicker() {
    setPickerLoading(true); setPicker([]); setMsg("");
    const j = await fetch("/api/fulfillers/printify-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setPickerLoading(false);
    if (j.ok) {
      setPicker(j.products);
      setDiag({ shopId: j.shopId, rawCount: j.rawCount });
      // Mặc định tick sản phẩm đã map (>0 variant đã map)
      setSel(new Set((j.products as PP[]).filter((p) => p.mappedCount > 0).map((p) => p.id)));
    } else { setMsg("⚠ " + j.error); setPicker(null); }
  }
  async function syncPicker() {
    setMsg("Đang đồng bộ…");
    const j = await fetch("/api/fulfillers/printify-sync-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active, selectedProductIds: Array.from(sel) }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { setMsg(`✓ Thêm ${j.added}, gỡ ${j.removed}`); setPicker(null); load(); }
    else setMsg("⚠ " + (j.error ?? "lỗi"));
  }
  const toggleSel = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function importMerchize() {
    setMsg("Đang kéo catalog Merchize…");
    const j = await fetch("/api/fulfillers/merchize-import-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) {
      setMsg(`✓ Tìm thấy ${j.found} SKU · thêm mới ${j.created}, bỏ qua ${j.skipped}`);
      if (j.found === 0 && j.rawSample) console.log("Merchize catalog rawSample:", j.rawSample);
      load();
    } else setMsg("⚠ " + (j.error ?? "lỗi"));
  }

  const mkOf = (name: string) => { const n = name.toLowerCase(); return n.includes("printify") ? "printify" : n.includes("tiktok") ? "tiktok" : "other"; };
  const th = { textAlign: "left" as const, fontSize: 11, color: "var(--faint)", fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".3px", padding: "8px 10px", borderBottom: "1px solid var(--line)" };
  const td = { padding: "7px 10px", borderBottom: "1px solid var(--line)", fontSize: 12.5, verticalAlign: "middle" as const };

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ fontWeight: 800, fontSize: 16 }}>SKU Mapping</h3>
          <div className="sub">Map SKU nội bộ ↔ SKU nhà fulfill + giá vốn (base/ship). Đẩy đơn dùng SKU này. Chia theo từng nhà cung cấp.</div>
        </div>
        {msg && <div style={{ fontWeight: 700, fontSize: 12.5, alignSelf: "center" }}>{msg}</div>}
      </div>

      {/* Tabs supplier */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, marginBottom: 14 }}>
        {ffs.map((f) => (
          <button key={f.id} onClick={() => setActive(f.id)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 11, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
              border: active === f.id ? "1.5px solid var(--blue)" : "1px solid var(--line)",
              background: active === f.id ? "var(--blue-soft)" : "var(--card)", color: active === f.id ? "var(--blue)" : "var(--ink)" }}>
            <MarketplaceLogo mk={mkOf(f.name)} size={16} /> {f.name}
            <span style={{ background: active === f.id ? "#fff" : "var(--line)", borderRadius: 6, padding: "1px 6px", fontSize: 11 }}>{countBy(f.id)}</span>
          </button>
        ))}
      </div>

      {ff && (
        <>
          {/* Thanh công cụ supplier */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <input placeholder="Tìm SKU / variant…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 220 }} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{rows.length} dòng</span>
            <div style={{ flex: 1 }} />
            {ff.method === "api" && ff.name.toLowerCase().includes("printify") && canEdit && (
              ff.shopId
                ? <button onClick={openPicker} style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>⟳ Cập nhật từ Printify</button>
                : <span style={{ fontSize: 12, color: "var(--amber)" }}>Cấu hình token + Shop ID ở Settings để kéo sản phẩm</span>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("merchize") && canEdit && (
              <button onClick={importMerchize} style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>⬇ Kéo SKU từ Merchize</button>
            )}
          </div>

          {/* Bảng mapping */}
          <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr>
                <th style={th}>SKU nội bộ</th><th style={th}>SKU {ff.name}</th><th style={th}>Sản phẩm / Variant</th>
                <th style={{ ...th, textAlign: "right" }}>Base</th><th style={{ ...th, textAlign: "right" }}>Ship</th><th style={{ ...th, textAlign: "right" }}>Tổng</th>
                {canEdit && <th style={{ ...th, textAlign: "right", width: 90 }}></th>}
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td style={{ ...td, textAlign: "center", color: "var(--muted)", padding: 24 }} colSpan={canEdit ? 7 : 6}>Chưa có mapping nào cho {ff.name}.</td></tr>}
                {rows.map((m) => {
                  const e = editRow[m.id];
                  return (
                    <tr key={m.id} style={e ? { background: "var(--blue-soft)" } : undefined}>
                      {e ? <>
                        <td style={td}><input value={e.internalSku ?? m.internalSku} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], internalSku: ev.target.value } }))} style={inp} /></td>
                        <td style={td}><input value={e.fulfillerSku ?? m.fulfillerSku} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], fulfillerSku: ev.target.value } }))} style={inp} /></td>
                        <td style={td}><input value={e.variant ?? m.variant ?? ""} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], variant: ev.target.value } }))} style={inp} /></td>
                        <td style={td}><input type="number" step="0.01" value={e.baseCost ?? m.baseCost} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], baseCost: ev.target.value } }))} style={{ ...inp, width: 74 }} /></td>
                        <td style={td}><input type="number" step="0.01" value={e.shipCost ?? m.shipCost} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], shipCost: ev.target.value } }))} style={{ ...inp, width: 74 }} /></td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{money(Number(e.baseCost ?? m.baseCost) + Number(e.shipCost ?? m.shipCost))}</td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => saveRow(m.id)} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 8, padding: "5px 10px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Lưu</button>
                          <button onClick={() => setEditRow((p) => { const n = { ...p }; delete n[m.id]; return n; })} style={{ marginLeft: 5, background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>✕</button>
                        </td>
                      </> : <>
                        <td style={{ ...td, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{m.internalSku}</td>
                        <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>{m.fulfillerSku}</td>
                        <td style={td}>{m.fulfillerProduct ? <span>{m.fulfillerProduct}{m.variant ? <span style={{ color: "var(--muted)" }}> · {m.variant}</span> : ""}</span> : (m.variant || <span style={{ color: "var(--faint)" }}>—</span>)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{money(m.baseCost)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{money(m.shipCost)}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{money(Number(m.baseCost) + Number(m.shipCost))}</td>
                        {canEdit && <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => setEditRow((p) => ({ ...p, [m.id]: {} }))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", fontWeight: 700, fontSize: 12 }}>Sửa</button>
                          <button onClick={() => delRow(m.id)} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontWeight: 700, fontSize: 12 }}>Xóa</button>
                        </td>}
                      </>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Thêm dòng */}
          {canEdit && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center", borderTop: "1px dashed var(--line)", paddingTop: 12 }}>
              <b style={{ fontSize: 12.5 }}>＋ Thêm:</b>
              <input placeholder="SKU nội bộ" value={nm.internalSku} onChange={(e) => setNm({ ...nm, internalSku: e.target.value })} style={{ ...inp, width: 150 }} />
              <input placeholder={`SKU ${ff.name}`} value={nm.fulfillerSku} onChange={(e) => setNm({ ...nm, fulfillerSku: e.target.value })} style={{ ...inp, width: 150 }} />
              <input placeholder="Variant (tùy chọn)" value={nm.variant} onChange={(e) => setNm({ ...nm, variant: e.target.value })} style={{ ...inp, width: 160 }} />
              <input type="number" step="0.01" placeholder="Base $" value={nm.baseCost} onChange={(e) => setNm({ ...nm, baseCost: e.target.value })} style={{ ...inp, width: 90 }} />
              <input type="number" step="0.01" placeholder="Ship $" value={nm.shipCost} onChange={(e) => setNm({ ...nm, shipCost: e.target.value })} style={{ ...inp, width: 90 }} />
              <button onClick={addMap} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>Thêm</button>
            </div>
          )}
        </>
      )}

      {/* Bộ chọn sản phẩm Printify */}
      {(picker !== null || pickerLoading) && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { if (!pickerLoading) setPicker(null); }}>
          <div style={{ background: "#fff", borderRadius: 18, width: 620, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <b style={{ fontSize: 16 }}>Chọn sản phẩm cần fulfill</b>
              {!pickerLoading && <button onClick={() => setPicker(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>Tick sản phẩm cần map, bỏ tick sản phẩm không cần. Bấm Lưu để đồng bộ (thêm SKU mới, gỡ SKU đã bỏ tick).</div>

            {pickerLoading ? <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Đang kéo sản phẩm từ Printify…</div> : (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                  <input placeholder="Tìm sản phẩm…" value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} style={{ ...inp, width: 200 }} />
                  <button onClick={() => setSel(new Set((picker ?? []).map((p) => p.id)))} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Chọn tất cả</button>
                  <button onClick={() => setSel(new Set())} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Bỏ chọn hết</button>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>Đã chọn {sel.size}/{picker?.length ?? 0}</span>
                </div>
                <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12, flex: 1 }}>
                  {(picker ?? []).filter((p) => !pickerQ || p.title.toLowerCase().includes(pickerQ.toLowerCase())).map((p) => (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 13px", borderBottom: "1px solid var(--line)", cursor: "pointer" }}>
                      <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} style={{ width: 17, height: 17, cursor: "pointer" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                          {p.total} SKU{p.mappedCount > 0 ? <span style={{ color: "#2E7D46", fontWeight: 700 }}> · đã map {p.mappedCount}</span> : ""}{p.noSku > 0 ? <span style={{ color: "var(--amber)" }}> · {p.noSku} variant chưa có SKU</span> : ""}
                        </div>
                      </div>
                    </label>
                  ))}
                  {(picker ?? []).length === 0 && (
                    <div style={{ padding: "20px 18px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.7 }}>
                      <b style={{ color: "var(--ink)", fontSize: 13 }}>Không có sản phẩm nào từ Printify.</b>
                      {diag && <div style={{ marginTop: 4 }}>Đang hỏi shop <b>{diag.shopId}</b> — Printify trả về {diag.rawCount} sản phẩm.</div>}
                      <div style={{ marginTop: 8 }}>Kiểm tra lần lượt:</div>
                      <div>• Token có scope <b>products.read</b> chưa? (tạo lại token, tick products.read)</div>
                      <div>• <b>Shop ID</b> có đúng shop chứa sản phẩm không? Bạn có 2 shop — thử đổi sang shop kia ở <b>Settings → Get shops</b>.</div>
                      <div>• Sản phẩm trên Printify đã <b>tạo xong</b> (không phải bản nháp trống) chưa?</div>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
                  <button onClick={() => setPicker(null)} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Hủy</button>
                  <button onClick={syncPicker} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>Lưu ({sel.size})</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
