// Tầng AI qua OPENROUTER (1 key cho mọi model: Claude/GPT/Gemini…). Env: OPENROUTER_API_KEY.
// Model text mặc định có thể override qua OPENROUTER_TEXT_MODEL. Provider-agnostic: đổi model = đổi slug.
const OR_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const KEY = () => (process.env.OPENROUTER_API_KEY ?? "").trim();
const TEXT_MODEL = () => (process.env.OPENROUTER_TEXT_MODEL ?? "anthropic/claude-3.5-sonnet").trim();

// Gọi chat completions, ÉP trả JSON object. Ném lỗi rõ ràng để UI hiện.
export async function orChatJSON<T>(system: string, user: string, opts?: { model?: string; maxTokens?: number; temperature?: number; images?: string[] }): Promise<T> {
  const key = KEY();
  if (!key) throw new Error("OPENROUTER_API_KEY chưa cấu hình trong env (Vercel → Settings → Environment Variables).");
  // Nếu có ảnh (data URL) → gửi multimodal: [text, image_url…]. Model text phải hỗ trợ vision.
  const imgs = (opts?.images ?? []).filter(Boolean);
  const userContent = imgs.length
    ? [{ type: "text", text: user }, ...imgs.map((u) => ({ type: "image_url", image_url: { url: u } }))]
    : user;
  let res: Response;
  try {
    res = await fetch(OR_CHAT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://fusionos.app",
        "X-Title": "FUSION Book Studio",
      },
      body: JSON.stringify({
        model: opts?.model ?? TEXT_MODEL(),
        messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
        response_format: { type: "json_object" },
        max_tokens: opts?.maxTokens ?? 3000,
        temperature: opts?.temperature ?? 0.8,
      }),
      // Fail SỚM (75s) trước mốc ~100s của Cloudflare → trả lỗi JSON rõ ràng thay vì gateway 502.
      signal: AbortSignal.timeout(75000),
    });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (/abort|timeout|signal|timed out/i.test(m)) throw new Error("Model text phản hồi quá lâu (>75s). Đổi Model text (⚙ Model AI) sang con NHANH: Claude Haiku / Gemini Flash / GPT‑4o‑mini; hoặc giảm số trang.");
    throw new Error("Lỗi gọi OpenRouter: " + m.slice(0, 160));
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 300)}`);
  let data: { choices?: { message?: { content?: string } }[] };
  try { data = JSON.parse(text); } catch { throw new Error("OpenRouter trả về không phải JSON."); }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter: nội dung rỗng.");
  // Vài model bọc JSON trong ```json ... ``` → gỡ rào.
  const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned) as T; }
  catch { throw new Error("Model trả về không phải JSON hợp lệ: " + cleaned.slice(0, 200)); }
}

const OR_IMAGE = "https://openrouter.ai/api/v1/images";
const IMAGE_MODEL = () => (process.env.OPENROUTER_IMAGE_MODEL ?? "google/gemini-2.5-flash-image").trim();

// Sinh 1 ẢNH: prompt + ảnh reference (giữ nhân vật). Trả base64 + media type + chi phí.
export async function orGenerateImage(prompt: string, refDataUrls: string[], opts?: { model?: string; outputFormat?: string; aspectRatio?: string; quality?: string; resolution?: string }): Promise<{ b64: string; mediaType: string; cost: number }> {
  const key = KEY();
  if (!key) throw new Error("OPENROUTER_API_KEY chưa cấu hình trong env.");
  const body: Record<string, unknown> = {
    model: opts?.model ?? IMAGE_MODEL(),
    prompt,
    output_format: opts?.outputFormat ?? "png",
  };
  if (opts?.quality) body.quality = opts.quality;          // không ép → dùng mặc định model (nhanh hơn)
  if (opts?.aspectRatio) body.aspect_ratio = opts.aspectRatio;
  if (opts?.resolution) body.resolution = opts.resolution;
  const refs = refDataUrls.filter(Boolean);
  if (refs.length) body.input_references = refs.map((u) => ({ type: "image_url", image_url: { url: u } }));
  const res = await fetch(OR_IMAGE, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://fusionos.app", "X-Title": "FUSION Book Studio" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(110000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenRouter image HTTP ${res.status}: ${text.slice(0, 300)}`);
  let data: { data?: { b64_json?: string; media_type?: string }[]; usage?: { cost?: number } };
  try { data = JSON.parse(text); } catch { throw new Error("OpenRouter image trả về không phải JSON."); }
  const img = data?.data?.[0];
  if (!img?.b64_json) throw new Error("OpenRouter image: không có ảnh trả về (" + text.slice(0, 200) + ")");
  return { b64: img.b64_json, mediaType: img.media_type ?? "image/png", cost: data?.usage?.cost ?? 0 };
}

// Danh sách model trên OpenRouter để UI chọn theo khâu. type=text (kịch bản/ý tưởng) | image (vẽ/mockup).
export async function listModels(type: "text" | "image" = "text"): Promise<{ id: string; name: string }[]> {
  const key = KEY();
  const res = await fetch("https://openrouter.ai/api/v1/models", { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(20000) });
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: string; name?: string; architecture?: { output_modalities?: string[]; modality?: string } }[] };
  const data = Array.isArray(j?.data) ? j.data : [];
  const want = type === "image" ? "image" : "text";
  return data
    .filter((m) => {
      const out = m?.architecture?.output_modalities;
      if (Array.isArray(out)) return out.includes(want);
      // fallback: modality dạng "text+image->text"
      const mod = m?.architecture?.modality ?? "";
      return mod.split("->")[1]?.includes(want) ?? (want === "text");
    })
    .map((m) => ({ id: String(m.id), name: String(m.name ?? m.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type BookIdea = { name: string; hook: string; angle: string; usp: string; outline: string[] };

// Ý TƯỞNG: brief → nhiều concept đầu sách.
export async function generateBookIdeas(brief: { occasion?: string; audience?: string; pages?: number; notes?: string; count?: number; model?: string; refImages?: string[]; competitor?: string }): Promise<BookIdea[]> {
  const n = Math.min(Math.max(brief.count ?? 4, 1), 8);
  const pages = brief.pages ?? 12;
  const refs = (brief.refImages ?? []).filter(Boolean);
  const comp = (brief.competitor ?? "").trim();
  const system = "Bạn là chuyên gia sáng tạo sách thiếu nhi personalized bán trên Etsy/TikTok (keepsake baby books, birthday book, sleep book…). Trả lời DUY NHẤT bằng JSON. TOÀN BỘ nội dung sinh ra (name, hook, angle, usp, outline) BẮT BUỘC bằng TIẾNG ANH — dù người dùng mô tả bằng tiếng Việt (sản phẩm bán cho khách nói tiếng Anh).";
  const user = `Sinh ${n} ý tưởng đầu sách KHÁC NHAU (mọi trường trả về bằng TIẾNG ANH).
Dịp/ngách: ${brief.occasion || "tuỳ bạn đề xuất"}
Đối tượng: ${brief.audience || "trẻ nhỏ / quà tặng cha mẹ"}
Số trang: ${pages}
Ghi chú: ${brief.notes || "không"}
${comp ? `\n===== PHÂN TÍCH ẢNH ĐỐI THỦ (BÁM SÁT) =====\n${comp}\n→ Ý tưởng của bạn PHẢI cùng NGÁCH / THỂ LOẠI với đối thủ ở trên (vd họ làm sách nàng tiên cá thì bạn cũng làm cùng ngách đó), nhưng KHÁC BIỆT & hấp dẫn hơn. Ghi rõ điểm khác biệt ở "usp". TUYỆT ĐỐI không lạc sang ngách khác.\n` : ""}
${refs.length ? `\nCÓ ĐÍNH KÈM ${refs.length} ẢNH LISTING ĐỐI THỦ. Đọc phong cách, ngách, bố cục, điểm bán; đề xuất ý tưởng CẠNH TRANH & KHÁC BIỆT (tránh sao chép).` : ""}

Mỗi ý tưởng cần:
- name: tên sách tiếng Anh hấp dẫn, chuẩn Etsy SEO
- hook: 1 câu chốt hạ vì sao khách mua
- angle: góc bán / cảm xúc chính
- usp: điểm khác biệt so với sách cùng loại (đặc biệt so với đối thủ nếu có ảnh)
- outline: mảng 4–6 câu TÓM TẮT diễn biến chính (KHÔNG cần đủ ${pages} trang — kịch bản chi tiết sẽ viết ở bước sau)

Trả JSON đúng dạng: {"ideas":[{"name":"","hook":"","angle":"","usp":"","outline":["",""]}]}`;
  const out = await orChatJSON<{ ideas: BookIdea[] }>(system, user, { maxTokens: 3000, model: brief.model, images: refs });
  return (out.ideas ?? []).map((i) => ({ name: i.name ?? "", hook: i.hook ?? "", angle: i.angle ?? "", usp: i.usp ?? "", outline: Array.isArray(i.outline) ? i.outline : [] }));
}

export type BookScriptPage = { page_no: number; text: string; illustration: string };

// KỊCH BẢN: concept đã chọn → lời văn + brief minh hoạ từng trang.
export async function generateBookScript(concept: { name: string; angle?: string; outline?: string[] }, opts?: { pages?: number; vars?: string[]; model?: string }): Promise<BookScriptPage[]> {
  const pages = opts?.pages ?? concept.outline?.length ?? 12;
  const vars = (opts?.vars && opts.vars.length ? opts.vars : ["name"]);
  const system = "Bạn viết kịch bản sách tranh thiếu nhi personalized (in KDP/Story Book). Lời văn ấm áp, hợp trẻ nhỏ, ngắn gọn mỗi trang. Brief minh hoạ phải CHI TIẾT, ĐIỆN ẢNH để AI vẽ đẹp. Trả lời DUY NHẤT bằng JSON.";
  const user = `Viết kịch bản đầy đủ cho cuốn: "${concept.name}".
Góc: ${concept.angle || ""}
Outline có sẵn:
${(concept.outline ?? []).map((o, i) => `${i + 1}. ${o}`).join("\n") || "(tự triển khai)"}

Yêu cầu:
- Đúng ${pages} trang.
- Biến cá nhân hoá chèn dạng {${vars.join("}, {")}} (vd {name}) vào lời văn khi hợp lý.
- text: lời văn TIẾNG ANH, 1–3 câu/trang, giọng ấm áp hợp trẻ nhỏ.
- illustration: mô tả cảnh TIẾNG ANH, CHI TIẾT (3–5 câu) như đạo diễn hình: bối cảnh cụ thể, tư thế + cảm xúc nhân vật chính, các vật thể/đạo cụ trong khung, ánh sáng/không khí, và GỢI Ý chừa một vùng nền dịu ở một phía để đặt chữ. KHÔNG mô tả chữ/tên xuất hiện trong tranh (chữ sẽ do khâu prompt xử lý riêng).

Trả JSON: {"pages":[{"page_no":1,"text":"","illustration":""}]}`;
  const out = await orChatJSON<Record<string, unknown>>(system, user, { maxTokens: 6000, model: opts?.model });
  // Chịu lỗi dạng: {pages:[…]} | mảng trực tiếp | object có 1 mảng bất kỳ (một số model đặt key khác).
  const asArr = (x: unknown): BookScriptPage[] | null => (Array.isArray(x) ? (x as BookScriptPage[]) : null);
  const arr: BookScriptPage[] = asArr((out as { pages?: unknown })?.pages)
    ?? asArr(out)
    ?? (asArr(Object.values(out ?? {}).find((v) => Array.isArray(v))) ?? []);
  if (!arr.length) throw new Error("Model không trả về trang nào — thử đổi Model text (⚙ Model AI) sang Claude/GPT mạnh hơn, hoặc bấm lại.");
  return arr.map((p, i) => ({ page_no: Number(p?.page_no) || i + 1, text: p?.text ?? "", illustration: p?.illustration ?? "" }));
}

// ===== STYLE BIBLE + COMPOSER (prompt chi tiết từng trang) =====
// Bible = khối "bí kíp" khai báo 1 LẦN cho mỗi tựa, ráp y hệt vào MỌI trang → giữ nhân vật/phong cách nhất quán.
export type BookBible = {
  format?: string;       // khổ trang + chất lượng
  character?: string;    // đặc điểm nhân vật (khoá mặt)
  wardrobe?: string;     // trang phục/đạo cụ cố định (để trống nếu không có)
  artStyle?: string;     // phong cách vẽ
  palette?: string;      // bảng màu
  textStyle?: string;    // quy tắc chữ (baked vào ảnh)
  restrictions?: string; // danh sách cấm
};

// Bible mặc định cho sách tranh personalized trẻ nhỏ — admin chỉnh lại theo từng tựa.
export function defaultBible(): BookBible {
  return {
    format:
      "Single horizontal landscape page, aspect ratio 23:17 (print 3450×2550px at 300 DPI). " +
      "Premium, professionally published children's picture-book quality. Keep the child's face and all text safely inside the trim margins.",
    character:
      "- approximately {age} years old\n- the SAME face, hair color, hairstyle and skin tone as the attached reference photo\n- soft round cheeks\n- warm, gentle, cheerful expression\n- realistic toddler body proportions\n- kind, curious and caring personality",
    wardrobe: "",
    artStyle:
      "Premium magical children's storybook digital painting. Soft cinematic lighting, expressive but gentle facial features, " +
      "realistic fabric texture, detailed dreamy backgrounds, warm golden highlights, polished professional illustration quality.",
    palette: "deep navy blue, soft sky blue, warm cream, teal blue, glowing golden accents",
    textStyle:
      "Use a clear, elegant, child-friendly serif font. Dark navy text on a clean, light-colored area. " +
      "All words correctly spelled, easy to read and professionally typeset. Do not place text over faces or visually busy areas. " +
      "Do not add page titles, page numbers, or any extra words.",
    restrictions:
      "- No copyrighted characters, costumes, symbols or logos\n- No distorted hands, fingers, faces or body proportions\n" +
      "- No misspelled text\n- No extra children except those described in the scene\n- No dark or frightening atmosphere\n" +
      "- No harsh yellow color cast\n- No overly cartoonish or exaggerated proportions\n" +
      "- Generate the flat page artwork only — no page mockup, no hands holding the book, no surrounding background",
  };
}

export type BookSetup = { bible: BookBible; vars: { key: string; label: string; type?: "text" | "image" }[] };

// AI TỰ DỰNG Style Bible + bộ biến TỪ CHỦ ĐỀ. Đây là lời giải "1 form cho vô số chủ đề":
// form chỉ nhận mô tả chủ đề, AI sinh phần riêng (nhân vật/trang phục/màu/cấm + biến hợp chủ đề).
export async function generateBookSetup(concept: { name: string; occasion?: string; audience?: string; angle?: string; notes?: string }, opts?: { model?: string }): Promise<BookSetup> {
  const system = "Bạn là art director sách tranh thiếu nhi personalized (in KDP/Story Book). Từ CHỦ ĐỀ, dựng 'Style Bible' (khối mô tả khoá nhân vật + phong cách để MỌI trang nhất quán) và đề xuất bộ BIẾN cá nhân hoá HỢP CHỦ ĐỀ. Trả lời DUY NHẤT bằng JSON. Mọi trường trong bible viết bằng TIẾNG ANH (để đưa thẳng vào prompt vẽ); label của biến có thể tiếng Việt.";
  const user = `Chủ đề: "${concept.name}".
Dịp/ngách: ${concept.occasion || "(tự suy luận)"}
Đối tượng: ${concept.audience || "trẻ nhỏ / quà tặng"}
Góc: ${concept.angle || ""}
Ghi chú: ${concept.notes || ""}

Sinh JSON đúng dạng:
{
  "bible": {
    "character": "đặc điểm NHÂN VẬT CHÍNH hợp chủ đề, khoá mặt theo ảnh reference; giữ placeholder {age} nếu tuổi quan trọng; gạch đầu dòng",
    "wardrobe": "trang phục/đạo cụ CỐ ĐỊNH đặc trưng chủ đề (vd đuôi tiên cá lấp lánh / áo choàng siêu anh hùng); để '' nếu chủ đề không cần",
    "artStyle": "phong cách vẽ (premium children's storybook digital painting…)",
    "palette": "bảng màu chủ đạo hợp chủ đề, liệt kê 4-6 màu",
    "textStyle": "quy tắc chữ baked: elegant child-friendly serif, dark navy on clean light area, correctly spelled, not over faces, no page numbers",
    "restrictions": "danh sách cấm phù hợp: an toàn trẻ em, không nhân vật/bản quyền, không lỗi tay/mặt, không chữ sai, flat artwork only… (gạch đầu dòng)",
    "format": "Single horizontal landscape page, aspect ratio 23:17 (print 3450×2550px at 300 DPI). Premium published picture-book quality."
  },
  "vars": [ {"key":"name","label":"Tên bé","type":"text"}, {"key":"age","label":"Tuổi","type":"text"}, … 3-6 biến HỢP CHỦ ĐỀ ]
}

QUY TẮC BIẾN (quan trọng):
- Mỗi biến có "type": "text" hoặc "image".
- Dùng "image" cho MỌI NHÂN VẬT có ẢNH THẬT của khách. Nếu chủ đề là "custom photo / face reference / dùng ảnh khách", HOẶC có nhiều người (bé, bố, mẹ, ông bà, thú cưng), thì BẮT BUỘC thêm biến ảnh cho TỪNG người: vd {"key":"babyPhoto","label":"Ảnh bé","type":"image"}, {"key":"dadPhoto","label":"Ảnh bố","type":"image"}, {"key":"momPhoto","label":"Ảnh mẹ","type":"image"}.
- Các biến còn lại (tên, tuổi, màu tóc, biệt danh, lời chúc…) để "type":"text".
- KHÔNG bỏ sót ảnh: chủ đề có bao nhiêu người dùng ảnh thật thì có bấy nhiêu biến "image".`;
  const out = await orChatJSON<BookSetup>(system, user, { maxTokens: 2500, model: opts?.model });
  const d = defaultBible();
  const rb = (out?.bible ?? {}) as BookBible;
  const bible: BookBible = {
    format: rb.format?.trim() || d.format,
    character: rb.character?.trim() || d.character,
    wardrobe: typeof rb.wardrobe === "string" ? rb.wardrobe : (d.wardrobe ?? ""),
    artStyle: rb.artStyle?.trim() || d.artStyle,
    palette: rb.palette?.trim() || d.palette,
    textStyle: rb.textStyle?.trim() || d.textStyle,
    restrictions: rb.restrictions?.trim() || d.restrictions,
  };
  const seen = new Set<string>();
  const vars = (Array.isArray(out?.vars) ? out.vars : [])
    .map((v) => ({ key: String(v?.key ?? "").replace(/[^a-zA-Z0-9_]/g, ""), label: String(v?.label ?? v?.key ?? ""), type: (v?.type === "image" ? "image" : "text") as "text" | "image" }))
    .filter((v) => v.key && !seen.has(v.key) && (seen.add(v.key), true));
  if (!vars.some((v) => v.key === "name")) vars.unshift({ key: "name", label: "Tên bé", type: "text" });
  // Bảo hiểm: chủ đề dùng ẢNH thật mà AI quên → thêm biến ảnh nhân vật.
  const usesPhoto = /photo|ảnh|anh khach|custom photo|face|reference|chân dung|hình thật/i.test(`${concept.name} ${concept.notes ?? ""} ${concept.occasion ?? ""}`);
  if (usesPhoto && !vars.some((v) => v.type === "image")) vars.unshift({ key: "photo", label: "Ảnh nhân vật", type: "image" });
  return { bible, vars };
}

// Ráp PROMPT CHI TIẾT cho 1 trang từ Bible + brief cảnh + lời văn. Có cấu trúc như prompt "chuẩn vàng".
// baked=true → hướng dẫn AI vẽ chữ thẳng vào tranh; baked=false → chừa vùng trống, không vẽ chữ (để overlay).
export function buildMasterPrompt(opts: { bookName: string; bible?: BookBible | null; brief: string; text: string; hasRef: boolean; baked?: boolean }): string {
  const B = { ...defaultBible(), ...(opts.bible ?? {}) };
  const baked = opts.baked !== false;
  const S: string[] = [];
  S.push(`Create a horizontal children's storybook page for "${opts.bookName}".`);
  S.push(`\nPAGE FORMAT:\n${B.format}`);
  S.push(
    `\nIMPORTANT CHARACTER CONSISTENCY:\n` +
    (opts.hasRef ? "Use the attached photograph of the child as the exact character reference.\n" : "") +
    `Preserve the child's recognizable features:\n${B.character}\n` +
    "Transform the child into a polished storybook illustration while keeping the face clearly recognizable. " +
    "Do not create a different child. Do not change the child's age, hair color, hairstyle, eye color, skin tone or face shape.",
  );
  if ((B.wardrobe ?? "").trim()) S.push(`\nWARDROBE & PROPS (identical on every page):\n${B.wardrobe}`);
  S.push(`\nART STYLE:\n${B.artStyle}\nColor palette: ${B.palette}`);
  S.push(`\nSCENE:\n${opts.brief || "(describe the scene for this page)"}`);
  const text = (opts.text ?? "").trim();
  if (baked && text) {
    S.push(
      `\nTEXT (render exactly, baked into the artwork):\n${B.textStyle}\n` +
      `Place this exact English text on the page:\n"${text}"\n` +
      "Leave a clean, softly-colored area for the text, away from the face and busy areas.",
    );
  } else if (text) {
    S.push(`\nTEXT AREA:\nLeave a clean, softly-colored empty area (upper or lower third) for a text caption to be overlaid later. Do NOT render any text, letters or words in the image.`);
  }
  S.push(`\nRESTRICTIONS:\n${B.restrictions}`);
  return S.join("\n");
}

// Thay biến cá nhân hoá vào prompt/chữ. Nhận cả {key} và [key] (không phân biệt hoa/thường).
export function resolveVars(tpl: string, vars: { key: string; value?: string }[] | null | undefined): string {
  let out = tpl ?? "";
  for (const v of vars ?? []) {
    const key = String(v.key ?? "").trim();
    if (!key) continue;
    const val = String(v.value ?? "").trim();
    if (!val) continue;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`[\\{\\[]\\s*${esc}\\s*[\\}\\]]`, "gi"), val);
  }
  return out;
}
