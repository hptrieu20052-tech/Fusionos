import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const G = "https://graph.facebook.com/v23.0";

/**
 * v656 · GET — 25 post ĐÃ ĐĂNG gần nhất của page kèm tương tác (like/comment/share),
 * cho Meta Ads kit chọn "chạy ad trên post có sẵn" (dồn social proof về 1 post thay vì dark post mới).
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  const pageId = process.env.META_PAGE_ID ?? "";
  if (!token || !pageId) return NextResponse.json({ ok: false, error: "META_SYSTEM_TOKEN / META_PAGE_ID missing" }, { status: 400 });
  try {
    const fields = "id,message,created_time,permalink_url,likes.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares";
    const res = await fetch(`${G}/${pageId}/published_posts?fields=${encodeURIComponent(fields)}&limit=25`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), cache: "no-store",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(String(j.error?.message ?? res.status).slice(0, 250));
    const posts = ((j.data ?? []) as Record<string, unknown>[]).map((p) => {
      const likes = Number(((p.likes as Record<string, unknown>)?.summary as Record<string, unknown>)?.total_count ?? 0);
      const comments = Number(((p.comments as Record<string, unknown>)?.summary as Record<string, unknown>)?.total_count ?? 0);
      const shares = Number((p.shares as Record<string, unknown>)?.count ?? 0);
      const d = String(p.created_time ?? "").slice(0, 10);
      const msg = String(p.message ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
      return {
        id: String(p.id ?? ""),
        permalink: String(p.permalink_url ?? ""),
        likes, comments, shares,
        label: `${d.slice(8, 10)}/${d.slice(5, 7)} · 👍${likes} 💬${comments}${shares ? ` ↗${shares}` : ""} · ${msg || "(no text)"}`,
      };
    }).filter((p) => p.id);
    // Tương tác cao lên đầu — đúng mục đích "chọn post uy tín nhất"
    posts.sort((a, b) => (b.likes + b.comments * 3 + b.shares * 5) - (a.likes + a.comments * 3 + a.shares * 5));
    return NextResponse.json({ ok: true, posts });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 400 });
  }
}
