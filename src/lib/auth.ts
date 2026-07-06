import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const COOKIE = "fusion_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me");

export type Session = {
  sub: string;        // user id
  role: typeof schema.users.$inferSelect["role"];
  name: string;
};

export async function login(email: string, password: string): Promise<{ ok: true; token: string; user: Session } | { ok: false }> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!u || u.status === "disabled") return { ok: false };
  const match = await bcrypt.compare(password, u.passwordHash);
  if (!match) return { ok: false };
  const user: Session = { sub: u.id, role: u.role, name: u.fullName };
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret());
  await db.update(schema.users).set({ lastActiveAt: new Date() }).where(eq(schema.users.id, u.id));
  return { ok: true, token, user };
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
