/**
 * v522 · TYPE CHIPS — gộp Product Types theo "group" thành 1 chip khi list.
 * Ví dụ 3 style "Men's Short Set / Men's Long Set / Men's Short-Sleeve Set" cùng group
 * "Men's Pajama" → form chỉ hiện 1 chip "Men's Pajama"; tick = tick cả 3 style
 * (meta _wcp_selected_styles vẫn ghi đủ 3 tên — ngoài site khách thấy 3 lựa chọn Style).
 * Style không có group → chip riêng như cũ. Dùng chung cho form product, bulk edit, template.
 */
export type TypeChip = { label: string; styles: string[]; grouped: boolean };

export function buildTypeChips(list: { styles?: unknown; group?: unknown }[]): TypeChip[] {
  const chips: TypeChip[] = [];
  const byGroup = new Map<string, TypeChip>();
  for (const s of list) {
    const name = String(s?.styles ?? "").trim();
    if (!name) continue;
    const g = String(s?.group ?? "").trim();
    if (g) {
      const key = g.toLowerCase();
      let c = byGroup.get(key);
      if (!c) { c = { label: g, styles: [], grouped: true }; byGroup.set(key, c); chips.push(c); }
      if (!c.styles.includes(name)) c.styles.push(name);
    } else {
      chips.push({ label: name, styles: [name], grouped: false });
    }
  }
  return chips;
}

/** Chip đang bật khi TẤT CẢ style của nó nằm trong danh sách đã chọn. */
export function chipOn(c: TypeChip, sel: string[]): boolean {
  return c.styles.every((s) => sel.includes(s));
}

/** Bật/tắt chip: tắt = gỡ mọi style của chip; bật = thêm đủ (không trùng). */
export function toggleChip(c: TypeChip, sel: string[]): string[] {
  return chipOn(c, sel)
    ? sel.filter((s) => !c.styles.includes(s))
    : [...sel, ...c.styles.filter((s) => !sel.includes(s))];
}
