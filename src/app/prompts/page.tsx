import { getSession } from "@/lib/auth";
import { listPromptsForAdmin } from "@/lib/ai/prompt-store";
import { PromptsClient } from "./prompts-client";

export const dynamic = "force-dynamic";

// Manager Prompts — CHỈ admin. Xem & sửa mọi system prompt AI (ghi đè DB, không cần deploy).
export default async function PromptsPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    return <div className="panel empty">Only Admin can access this page.</div>;
  }
  const prompts = await listPromptsForAdmin();
  return <PromptsClient initial={prompts} />;
}
