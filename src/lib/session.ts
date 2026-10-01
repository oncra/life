import { randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { hashKey } from "./auth";
import { sendMail } from "./mail";

// People who build a Life Box sign in with a six-digit code sent to their email. No passwords, no links
// (a code also works when the mail is read on a phone and the download happens on a laptop).
export const SESSION_COOKIE = "life_session";
const SESSION_DAYS = 30;
const CODE_MINUTES = 15;

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

export async function sendLoginCode(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const recent = await prisma.loginCode.count({ where: { email, createdAt: { gt: new Date(Date.now() - 10 * 60e3) } } });
  if (recent >= 3) return { ok: false, error: "We sent you three codes in the last ten minutes. Use the newest one, or wait a few minutes." };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.loginCode.create({ data: { email, codeHash: hashKey(`${email}:${code}`), expiresAt: new Date(Date.now() + CODE_MINUTES * 60e3) } });
  await sendMail({
    to: email,
    subject: `${code} is your Life Box code`,
    text: `Your code: ${code}\n\nType it on the page where you asked for it. It works for ${CODE_MINUTES} minutes.\n\nIf you did not ask for this, you can ignore this mail.\n\nLife oracle, ${process.env.NEXT_PUBLIC_SITE_URL ?? "https://life.oncra.org"}`,
  });
  return { ok: true };
}

/** Checks the newest unused code for this address and opens a session. Returns the session token for the cookie. */
export async function verifyLoginCode(email: string, code: string): Promise<string | null> {
  const c = await prisma.loginCode.findFirst({ where: { email, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!c || c.attempts >= 5) return null;
  if (c.codeHash !== hashKey(`${email}:${code.replace(/\D/g, "")}`)) {
    await prisma.loginCode.update({ where: { id: c.id }, data: { attempts: { increment: 1 } } });
    return null;
  }
  await prisma.loginCode.update({ where: { id: c.id }, data: { usedAt: new Date() } });
  const user = await prisma.user.upsert({ where: { email }, create: { email, lastLogin: new Date() }, update: { lastLogin: new Date() } });
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, tokenHash: hashKey(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400e3) } });
  return token;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
}

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: hashKey(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashKey(token) } });
  jar.delete(SESSION_COOKIE);
}
