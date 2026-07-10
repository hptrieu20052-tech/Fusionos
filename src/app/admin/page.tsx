import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { AdminClient } from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    return <div className="panel empty">Chỉ Admin được truy cập trang này.</div>;
  }
  const [users, perms, roleRestr, dataScopes, roleActs] = await Promise.all([
    db.select({
      id: schema.users.id, fullName: schema.users.fullName, email: schema.users.email,
      role: schema.users.role, team: schema.users.team, status: schema.users.status,
      avatarKey: schema.users.avatarKey,
    }).from(schema.users),
    db.select().from(schema.rolePermissions),
    db.select().from(schema.roleRestrictions).catch(() => []),      // bảng có thể chưa migrate
    db.select().from(schema.roleDataScopes).catch(() => []),        // bảng có thể chưa migrate
    db.select().from(schema.roleActions).catch(() => []),           // bảng có thể chưa migrate
  ]);
  const usersOut = users.map((u) => ({ ...u, avatarUrl: fileUrl(u.avatarKey) }));
  return <AdminClient users={usersOut} permissions={perms} roleRestrictions={roleRestr} dataScopes={dataScopes} actions={schema.ACTIONS} roleActions={roleActs} />;
}
