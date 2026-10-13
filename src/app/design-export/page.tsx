import { getSession } from "@/lib/auth";
import DesignExportClient from "./design-export-client";

export const dynamic = "force-dynamic";

// v649 · Tải toàn bộ file design của 1 seller về máy — admin only.
export default async function DesignExportPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return <div className="panel empty">Design export is admin-only.</div>;
  }
  return <DesignExportClient />;
}
