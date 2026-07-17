// Tầng AI qua OPENROUTER (1 key cho mọi model: Claude/GPT/Gemini…). Env: OPENROUTER_API_KEY.
// Model text mặc định có thể override qua OPENROUTER_TEXT_MODEL. Provider-agnostic: đổi model = đổi slug.
const OR_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const KEY = () => (process.env.OPENROUTER_API_KEY ?? "").trim();
const TEXT_MODEL = () => (process.env.OPENROUTER_TEXT_MODEL ?? "anthropic/claude-3.5-sonnet").trim();

// Gọi chat completions, ÉP trả JSON object. Ném lỗi rõ ràng để UI hiện.
export async function orChatJSON<T>(system: string, user: string, opts?: { model?: string; maxTokens?: number; temperature?: number }): Promise<T> {
  const key = KEY();
  if (!key) throw new Error("OPENROUTER_API_KEY chưa cấu hình trong env (Vercel → Settings → Environment Variables).");
  const res = await fetch(OR_CHAT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://fusionos.app",
      "X-Title": "FUSION Book Studio",
    },
    body: JSON.stringify({
      model: opts?.model ?? TEXT_MODEL(),
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      max_tokens: opts?.maxTokens ?? 3000,
      temperature: opts?.temperature ?? 0.8,
    }),
    signal: AbortSignal.timeout(90000),
  });
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
export async function generateBookIdeas(brief: { occasion?: string; audience?: string; pages?: number; notes?: string; count?: number; model?: string }): Promise<BookIdea[]> {
  const n = Math.min(Math.max(brief.count ?? 4, 1), 8);
  const pages = brief.pages ?? 12;
  const system = "Bạn là chuyên gia sáng tạo sách thiếu nhi personalized bán trên Etsy/TikTok (keepsake baby books, birthday book, sleep book…). Trả lời DUY NHẤT bằng JSON.";
  const user = `Sinh ${n} ý tưởng đầu sách KHÁC NHAU.
Dịp/ngách: ${brief.occasion || "tuỳ bạn đề xuất"}
Đối tượng: ${brief.audience || "trẻ nhỏ / quà tặng cha mẹ"}
Số trang: ${pages}
Ghi chú: ${brief.notes || "không"}

Mỗi ý tưởng cần:
- name: tên sách tiếng Anh hấp dẫn, chuẩn Etsy SEO
- hook: 1 câu chốt hạ vì sao khách mua
- angle: góc bán / cảm xúc chính
- usp: điểm khác biệt so với sách cùng loại
- outline: mảng ${pages} câu ngắn, mỗi câu = nội dung 1 trang

Trả JSON đúng dạng: {"ideas":[{"name":"","hook":"","angle":"","usp":"","outline":["",""]}]}`;
  const out = await orChatJSON<{ ideas: BookIdea[] }>(system, user, { maxTokens: 4000, model: brief.model });
  return (out.ideas ?? []).map((i) => ({ name: i.name ?? "", hook: i.hook ?? "", angle: i.angle ?? "", usp: i.usp ?? "", outline: Array.isArray(i.outline) ? i.outline : [] }));
}

export type BookScriptPage = { page_no: number; text: string; illustration: string };

// KỊCH BẢN: concept đã chọn → lời văn + brief minh hoạ từng trang.
export async function generateBookScript(concept: { name: string; angle?: string; outline?: string[] }, opts?: { pages?: number; vars?: string[]; model?: string }): Promise<BookScriptPage[]> {
  const pages = opts?.pages ?? concept.outline?.length ?? 12;
  const vars = (opts?.vars && opts.vars.length ? opts.vars : ["name"]);
  const system = "Bạn viết kịch bản sách thiếu nhi personalized. Lời văn ấm áp, hợp trẻ nhỏ, ngắn gọn mỗi trang. Trả lời DUY NHẤT bằng JSON.";
  const user = `Viết kịch bản đầy đủ cho cuốn: "${concept.name}".
Góc: ${concept.angle || ""}
Outline có sẵn:
${(concept.outline ?? []).map((o, i) => `${i + 1}. ${o}`).join("\n") || "(tự triển khai)"}

Yêu cầu:
- Đúng ${pages} trang.
- Biến cá nhân hoá chèn dạng {${vars.join("}, {")}} (vd {name}) vào lời văn khi hợp lý.
- Mỗi trang: text (lời văn tiếng Anh), illustration (mô tả cảnh cho hoạ sĩ/AI vẽ: bối cảnh, nhân vật, cảm xúc — TUYỆT ĐỐI KHÔNG chứa chữ/tên trong tranh).

Trả JSON: {"pages":[{"page_no":1,"text":"","illustration":""}]}`;
  const out = await orChatJSON<{ pages: BookScriptPage[] }>(system, user, { maxTokens: 5000, model: opts?.model });
  return (out.pages ?? []).map((p, i) => ({ page_no: Number(p.page_no) || i + 1, text: p.text ?? "", illustration: p.illustration ?? "" }));
}
