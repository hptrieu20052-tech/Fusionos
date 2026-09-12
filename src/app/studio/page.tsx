import { getSession } from "@/lib/auth";
import StudioClient from "./studio-client";

export const dynamic = "force-dynamic";

// v484 · Studio "Create Your Own" — admin cấu hình wizard cho khách trên talewix.com:
// bật/tắt, CHỌN MODEL gen ảnh, limit, watermark, prompt, danh sách template + kho lead.
export default async function StudioPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return <div className="panel empty">Studio settings are admin-only.</div>;
  }
  return <StudioClient />;
}
