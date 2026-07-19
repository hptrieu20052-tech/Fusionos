import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orGenerateImage, buildMasterPrompt, resolveVars, BookBible } from "@/lib/ai/openrouter";
import { readFile, writeFile, fileUrl } from "@/lib/storage";
import {
  getBookProduct, blockForPage, coverPanelW,
  pageFormatText, spreadFormatText, coverFormatText,
  pageAspect, spreadAspect, coverAspect,
} from "@/lib/book-products";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Var = { key: string; value?: string; type?: string; imageKey?: string };
type PageRow = { pageNo: number; textTemplate: string | null; illustrationBrief: string | null; promptTemplate: string | null };

// POST /api/books/[id]/illustrate { pageNo, model, baked, vars }
// pageNo 0 = COVER (5370×2850 / 7470×3000). Trang 1 & cuối = vẽ ĐƠN (khổ trang). Cặp giữa = vẽ SPREAD nối rồi CẮT ĐÔI.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const pageNo = Number(b?.pageNo);
  if (!Number.isFinite(pageNo) || pageNo < 0) return NextResponse.json({ ok: false, error: "pageNo required" }, { status: 400 });

  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const product = getBookProduct(title.productKey);
  const blk = blockForPage(product, pageNo);
  if (!blk) return NextResponse.json({ ok: false, error: `page ${pageNo} not in product layout` }, { status: 400 });

  const baked = b?.baked !== false;
  const bible = (title.bible ?? null) as BookBible | null;

  // ---- Ảnh reference nhân vật (legacy + biến kiểu image), tối đa 4, thu nhỏ 768px ----
  const refKeys: string[] = [];
  if (title.characterRefKey) refKeys.push(title.characterRefKey);
  for (const v of (Array.isArray(title.vars) ? (title.vars as Var[]) : [])) {
    if (v && v.type === "image" && v.imageKey && !refKeys.includes(v.imageKey)) refKeys.push(v.imageKey);
  }
  const refs: string[] = [];
  for (const key of refKeys.slice(0, 4)) {
    try {
      const buf = await readFile(key);
      let refBuf = buf;
      try {
        const sharp = (await import("sharp")).default;
        refBuf = await sharp(buf).rotate().resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      } catch { /* resize lỗi → ảnh gốc */ }
      refs.push(`data:image/jpeg;base64,${refBuf.toString("base64")}`);
    } catch { /* đọc lỗi → bỏ qua */ }
  }
  const hasRef = refs.length > 0;

  // ---- Gộp biến để thay {name}… ----
  const titleVars = Array.isArray(title.vars) ? (title.vars as Var[]) : [];
  const reqVars = Array.isArray(b?.vars) ? (b.vars as Var[]) : [];
  const mergedVars = [...titleVars.filter((v) => !reqVars.some((r) => r.key === v.key)), ...reqVars];
  const model = b?.model ? String(b.model) : undefined;

  const loadPage = async (n: number): Promise<PageRow | null> => {
    const [p] = await db.select().from(schema.bookPages)
      .where(and(eq(schema.bookPages.titleId, params.id), eq(schema.bookPages.pageNo, n))).limit(1);
    return (p as PageRow) ?? null;
  };
  const saveAsset = async (n: number, buf: Buffer) => {
    const key = `book-illustrations/${params.id}-p${n}-${Date.now()}.png`;
    await writeFile(key, buf, "image/png");
    await db.delete(schema.bookAssets).where(and(eq(schema.bookAssets.titleId, params.id), eq(schema.bookAssets.pageNo, n)));
    await db.insert(schema.bookAssets).values({ titleId: params.id, pageNo: n, storageKey: key, model: model ?? null });
    return fileUrl(key) ?? "";
  };

  try {
    const sharp = (await import("sharp")).default;
    const urls: Record<number, string> = {};
    let cost = 0;

    // ================= REMAKE MODE (Custom books từ DESIGN CÓ SẴN) =================
    // Bản khách (sourceId) + block KHÔNG có prompt (design import, không phải AI-made)
    // → nạp ẢNH GỐC của master làm reference, tái tạo Y HỆT, CHỈ thay biến cá nhân hoá của khách.
    const storedPromptOf = async (): Promise<string> => {
      if (blk.type === "cover") return String((title.cover as { prompt?: string } | null)?.prompt ?? "").trim();
      if (blk.type === "single") return String((await loadPage(blk.page))?.promptTemplate ?? "").trim();
      return String((await loadPage(blk.pages[0]))?.promptTemplate ?? "").trim();
    };
    if (title.sourceId && !(await storedPromptOf())) {
      const wantNos = blk.type === "cover" ? [-1, 0] : blk.type === "single" ? [blk.page] : [...blk.pages];
      const mAssets = await db.select({ pageNo: schema.bookAssets.pageNo, storageKey: schema.bookAssets.storageKey })
        .from(schema.bookAssets)
        .where(and(eq(schema.bookAssets.titleId, title.sourceId), inArray(schema.bookAssets.pageNo, wantNos)));
      const mMap = new Map(mAssets.map((a) => [a.pageNo, a.storageKey]));
      const lack = wantNos.filter((n) => !mMap.has(n));
      if (lack.length) {
        return NextResponse.json({ ok: false, error: `Master design chưa có ảnh gốc cho: ${lack.map((n) => n === 0 ? "cover_front" : n === -1 ? "back_cover" : "page " + n).join(", ")} — upload thêm file đó vào design rồi import lại.` }, { status: 400 });
      }

      // Ghép ẢNH GỐC thành đúng khối vẽ (cover wraparound liền / spread liền / trang đơn) rồi thu nhỏ làm reference.
      let refBuf: Buffer;
      if (blk.type === "cover") {
        const cw = coverPanelW(product);
        const back = await sharp(await readFile(mMap.get(-1)!)).resize(cw, product.coverH, { fit: "fill" }).png().toBuffer();
        const front = await sharp(await readFile(mMap.get(0)!)).resize(product.coverW - cw, product.coverH, { fit: "fill" }).png().toBuffer();
        refBuf = await sharp({ create: { width: product.coverW, height: product.coverH, channels: 3, background: "#fff" } })
          .composite([{ input: back, left: 0, top: 0 }, { input: front, left: cw, top: 0 }]).png().toBuffer();
      } else if (blk.type === "spread") {
        const L = await sharp(await readFile(mMap.get(blk.pages[0])!)).resize(product.pageW, product.pageH, { fit: "fill" }).png().toBuffer();
        const R = await sharp(await readFile(mMap.get(blk.pages[1])!)).resize(product.pageW, product.pageH, { fit: "fill" }).png().toBuffer();
        refBuf = await sharp({ create: { width: product.pageW * 2, height: product.pageH, channels: 3, background: "#fff" } })
          .composite([{ input: L, left: 0, top: 0 }, { input: R, left: product.pageW, top: 0 }]).png().toBuffer();
      } else {
        refBuf = await readFile(mMap.get(blk.page)!);
      }
      const refSmall = await sharp(refBuf).resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      const masterRef = `data:image/jpeg;base64,${refSmall.toString("base64")}`;

      // Danh sách THAY ĐỔI: so biến GỐC của master (value = giá trị đang in) với biến KHÁCH (mergedVars).
      const [masterTitle] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, title.sourceId)).limit(1);
      const masterVars = Array.isArray(masterTitle?.vars) ? (masterTitle!.vars as Var[]) : [];
      const changes: string[] = [];
      for (const mv of masterVars) {
        const cv = mergedVars.find((v) => v.key === mv.key);
        if (!cv) continue;
        const label = (mv as { label?: string }).label || mv.key;
        if ((mv.type ?? "text") === "image") {
          if (cv.imageKey) changes.push(`Replace the ${label}'s face and appearance to match the attached customer reference photo — keep the pose, outfit, position, size and art style EXACTLY as in the original.`);
        } else {
          const orig = String(mv.value ?? "").trim();
          const next = String(cv.value ?? "").trim();
          if (orig && next && orig !== next) changes.push(`Replace every occurrence of the text "${orig}" with "${next}" — match the original font, size, color, curvature and placement exactly.`);
          else if (!orig && next) changes.push(`Set the personalized ${label} text in the design to "${next}" — match the existing text style exactly.`);
        }
      }
      const what = blk.type === "cover"
        ? `full WRAPAROUND COVER (LEFT half = back cover, RIGHT half = front cover — one continuous image across the center fold)`
        : blk.type === "spread"
          ? `DOUBLE-PAGE SPREAD (two pages side by side forming one continuous image)`
          : `single page`;
      const format = blk.type === "cover" ? coverFormatText(product) : blk.type === "spread" ? spreadFormatText(product, blk.pages[0], blk.pages[1]) : pageFormatText(product);
      const prompt =
        `The FIRST attached image is the ORIGINAL ${what} of a finished children's book design.\n` +
        `TASK: Recreate this artwork EXACTLY — identical composition, characters, poses, expressions, colors, art style, lighting, background, decorative elements and text layout. ` +
        `This is a faithful high-fidelity reproduction, NOT a reinterpretation. Do not add, remove, move or restyle anything.\n\n` +
        `APPLY ONLY these personalization changes:\n` +
        (changes.length ? changes.map((c, i) => `${i + 1}. ${c}`).join("\n") : "(none provided — reproduce the original exactly)") +
        `\n\nEverything NOT listed above must stay identical to the original image.\n\n` +
        `OUTPUT FORMAT (this overrides any size mentioned above):\n${format}`;

      const aspect = blk.type === "cover" ? coverAspect(product) : blk.type === "spread" ? spreadAspect(product) : pageAspect(product);
      const img = await orGenerateImage(prompt, [masterRef, ...refs.slice(0, 3)], { model, outputFormat: "png", aspectRatio: aspect });
      cost += img.cost;

      if (blk.type === "cover") {
        const full = await sharp(Buffer.from(img.b64, "base64")).resize(product.coverW, product.coverH, { fit: "fill" }).png().toBuffer();
        const cw = coverPanelW(product);
        const back = await sharp(full).extract({ left: 0, top: 0, width: cw, height: product.coverH }).png().toBuffer();
        const front = await sharp(full).extract({ left: cw, top: 0, width: product.coverW - cw, height: product.coverH }).png().toBuffer();
        urls[0] = await saveAsset(0, front);
        urls[-1] = await saveAsset(-1, back);
      } else if (blk.type === "spread") {
        const full = await sharp(Buffer.from(img.b64, "base64")).resize(product.pageW * 2, product.pageH, { fit: "fill" }).png().toBuffer();
        const left = await sharp(full).extract({ left: 0, top: 0, width: product.pageW, height: product.pageH }).png().toBuffer();
        const right = await sharp(full).extract({ left: product.pageW, top: 0, width: product.pageW, height: product.pageH }).png().toBuffer();
        urls[blk.pages[0]] = await saveAsset(blk.pages[0], left);
        urls[blk.pages[1]] = await saveAsset(blk.pages[1], right);
      } else {
        const out = await sharp(Buffer.from(img.b64, "base64")).resize(product.pageW, product.pageH, { fit: "fill" }).png().toBuffer();
        urls[blk.page] = await saveAsset(blk.page, out);
      }

      if (title.status === "script") await db.update(schema.bookTitles).set({ status: "simulation", updatedAt: new Date() }).where(eq(schema.bookTitles.id, params.id));
      const fk = Number(Object.keys(urls)[0]);
      return NextResponse.json({ ok: true, pageNo, url: urls[fk], urls, cost, remake: true });
    }
    // ================= HẾT REMAKE MODE — dưới đây là luồng vẽ theo PROMPT như cũ =================

    if (blk.type === "cover") {
      // COVER wraparound LIỀN: vẽ 1 ảnh nối → nửa PHẢI = mặt trước (tiêu đề+nhân vật), nửa TRÁI = mặt sau (cảnh nối tiếp, không chữ). Cắt đôi.
      const cover = (title.cover ?? {}) as { text?: string; brief?: string; prompt?: string };
      const defaultBrief =
        "A single continuous wraparound cover scene.\n" +
        "RIGHT half = FRONT cover: the hero character (warm, magical) + a clear calm area for the book title.\n" +
        "LEFT half = BACK cover: the SAME scenery continuing seamlessly (sky, sea, horizon, landscape) with NO title and NO extra characters — a restful open area.\n" +
        "Blend both halves into ONE unbroken image across the center fold.";
      const stored = (cover.prompt ?? "").trim();
      const raw = stored
        ? `${stored}\n\nOUTPUT FORMAT (this overrides any size mentioned above):\n${coverFormatText(product)}`
        : buildMasterPrompt({
            bookName: title.name, bible,
            brief: (cover.brief ?? "").trim() || defaultBrief,
            text: baked ? ((cover.text ?? "").trim() || title.name) : "",
            hasRef, baked, format: coverFormatText(product),
          });
      const prompt = resolveVars(raw, mergedVars);
      const img = await orGenerateImage(prompt, refs, { model, outputFormat: "png", aspectRatio: coverAspect(product) });
      cost += img.cost;
      const full = await sharp(Buffer.from(img.b64, "base64")).resize(product.coverW, product.coverH, { fit: "fill" }).png().toBuffer();
      const cw = coverPanelW(product);
      const back = await sharp(full).extract({ left: 0, top: 0, width: cw, height: product.coverH }).png().toBuffer();
      const front = await sharp(full).extract({ left: cw, top: 0, width: product.coverW - cw, height: product.coverH }).png().toBuffer();
      urls[0] = await saveAsset(0, front);    // pageNo 0  = FRONT (nửa phải)
      urls[-1] = await saveAsset(-1, back);   // pageNo -1 = BACK (nửa trái)

    } else if (blk.type === "single") {
      const page = await loadPage(blk.page);
      if (!page) return NextResponse.json({ ok: false, error: `page ${blk.page} not found` }, { status: 404 });
      const base = (page.promptTemplate ?? "").trim() || buildMasterPrompt({
        bookName: title.name, bible, brief: page.illustrationBrief ?? "", text: page.textTemplate ?? "", hasRef, baked,
      });
      // Ép KHỔ CHUẨN của sản phẩm (thắng mọi khổ nêu ở trên).
      const raw = `${base}\n\nOUTPUT FORMAT (this overrides any size mentioned above):\n${pageFormatText(product)}`;
      const prompt = resolveVars(raw, mergedVars);
      const img = await orGenerateImage(prompt, refs, { model, outputFormat: "png", aspectRatio: pageAspect(product) });
      cost += img.cost;
      const out = await sharp(Buffer.from(img.b64, "base64")).resize(product.pageW, product.pageH, { fit: "fill" }).png().toBuffer();
      urls[blk.page] = await saveAsset(blk.page, out);

    } else {
      // SPREAD: nạp CẢ CẶP (trang L + R) vào AI, vẽ 1 ảnh nối LIỀN MẠCH rồi CẮT ĐÔI → 2 file trang.
      // Dùng promptTemplate của trang TRÁI (đã ráp thành 1 cảnh liền ở bước compose) nếu có; nếu chưa thì ráp tại chỗ từ 1 cảnh chung.
      const [L, R] = blk.pages;
      const lp = await loadPage(L); const rp = await loadPage(R);
      const lText = (lp?.textTemplate ?? "").trim();
      const rText = (rp?.textTemplate ?? "").trim();
      const combinedText = baked
        ? [lText && `LEFT half text: "${lText}"`, rText && `RIGHT half text: "${rText}"`].filter(Boolean).join("\n")
        : "";
      let sharedBrief = (lp?.illustrationBrief ?? "").trim() || "One continuous scene spanning the whole double-page spread.";
      const textSide = lText && !rText ? "LEFT" : (!lText && rText ? "RIGHT" : null);
      if (textSide) {
        const artSide = textSide === "LEFT" ? "RIGHT" : "LEFT";
        sharedBrief += `\nLAYOUT: the ${textSide} half is the TEXT side — keep it a calm, open, softly-lit part of the same continuous scene (gentle background wash, small ambient details only, NO main characters there). Place the MAIN SUBJECT fully inside the ${artSide} half. Bake the caption text onto the ${textSide} half only, beautifully centered in the open area.`;
      }
      const stored = (lp?.promptTemplate ?? "").trim();
      const raw = stored
        ? `${stored}\n\nOUTPUT FORMAT (this overrides any size mentioned above):\n${spreadFormatText(product, L, R)}`
        : buildMasterPrompt({
            bookName: title.name, bible,
            brief: sharedBrief,
            text: combinedText, hasRef, baked, format: spreadFormatText(product, L, R),
          });
      const prompt = resolveVars(raw, mergedVars);
      const img = await orGenerateImage(prompt, refs, { model, outputFormat: "png", aspectRatio: spreadAspect(product) });
      cost += img.cost;
      const full = await sharp(Buffer.from(img.b64, "base64")).resize(product.pageW * 2, product.pageH, { fit: "fill" }).png().toBuffer();
      const left = await sharp(full).extract({ left: 0, top: 0, width: product.pageW, height: product.pageH }).png().toBuffer();
      const right = await sharp(full).extract({ left: product.pageW, top: 0, width: product.pageW, height: product.pageH }).png().toBuffer();
      urls[L] = await saveAsset(L, left);
      urls[R] = await saveAsset(R, right);
    }

    if (title.status === "script") await db.update(schema.bookTitles).set({ status: "simulation", updatedAt: new Date() }).where(eq(schema.bookTitles.id, params.id));
    const firstKey = Number(Object.keys(urls)[0]);
    return NextResponse.json({ ok: true, pageNo, url: urls[firstKey], urls, cost });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
