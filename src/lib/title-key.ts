// v180 - KHOA TITLE dung chung cho chong trung (import Etsy + stage sang Shopify).
// Hai listing la 'cung mot mau' khi titleKey giong nhau. Song sot qua: (1) MOJIBAKE
// (UTF-8 doc nham windows-1252 - thu pham cap trung BlueSun22 lot luoi v118),
// (2) nhay cong/thang, gach ngang cac loai, zero-width, space thua, hoa thuong.
// Sua mojibake TRUOC khi NFKC (NFKC doi TM-sign thanh 'tm' lam mat dau vet).

const MOJIBAKE: [RegExp, string][] = [
  [/\u00e2\u20ac\u2122|\u00e2\u20ac\u02dc/g, "'"],
  [/\u00e2\u20ac\u0153|\u00e2\u20ac\x9d/g, "\""],
  [/\u00e2\u20ac\u201c|\u00e2\u20ac\u201d/g, "-"],
  [/\u00e2\u20ac\u00a6/g, "..."],
  [/\u00c2(?=[\s,.!?'\"-]|$)/g, ""],
  [/\u00c3\u00a9/g, "e"],
  [/\u00c3\u00a8/g, "e"],
  [/\u00c3\u00a1/g, "a"],
  [/\u00c3\u00a0/g, "a"],
  [/\u00c3\u00ad/g, "i"],
  [/\u00c3\u00b3/g, "o"],
  [/\u00c3\u00ba/g, "u"],
  [/\u00c3\u00b1/g, "n"],
];

export function fixMojibake(v: string): string {
  let out = v ?? "";
  for (const [re, rep] of MOJIBAKE) out = out.replace(re, rep);
  return out;
}

export function titleKey(v: string): string {
  return fixMojibake(v ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
