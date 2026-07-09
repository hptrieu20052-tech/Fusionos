import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { AdminClient } from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    return <div className="panel empty">Chỉ Admin được truy cập trang này.</div>;
  }
  const [users, perms, roleRestr] = await Promise.all([
    db.select({
      id: schema.users.id, fullName: schema.users.fullName, email: schema.users.email,
      role: schema.users.role, team: schema.users.team, status: schema.users.status,
    }).from(schema.users),
    db.select().from(schema.rolePermissions),
    db.select().from(schema.roleRestrictions),
  ]);
  return <AdminClient users={users} permissions={perms} roleRestrictions={roleRestr} />;
}
