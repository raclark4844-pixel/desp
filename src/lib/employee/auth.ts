import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { digest } from "./password";
export const EMPLOYEE_COOKIE = "ap_employee";
export const SESSION_AGE = 8 * 60 * 60;
export const employeeView = {
  id: true,
  username: true,
  email: true,
  name: true,
  isAdmin: true,
  isActive: true,
  mustChangePassword: true,
} as const;
export function sessionToken(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${EMPLOYEE_COOKIE}=`))
    ?.slice(EMPLOYEE_COOKIE.length + 1);
}
export async function employeeFromRequest(
  request: Request,
  allowPasswordChange = false,
) {
  const token = sessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.employeeSession.findUnique({
    where: { tokenHash: digest(token) },
    include: { employee: { select: employeeView } },
  });
  if (
    !session ||
    session.expiresAt <= new Date() ||
    !session.employee.isActive ||
    (!allowPasswordChange && session.employee.mustChangePassword)
  )
    return null;
  return session.employee;
}
export function newSession() {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: digest(token),
    expiresAt: new Date(Date.now() + SESSION_AGE * 1000),
  };
}
export async function throttle(key: string, limit: number) {
  const hashed = digest(key);
  const rows = await db.$queryRaw<{ attempts: number }[]>`
    INSERT INTO "LoginAttempt" (key, attempts, "windowAt") VALUES (${hashed}, 1, NOW())
    ON CONFLICT (key) DO UPDATE SET
    attempts = CASE WHEN "LoginAttempt"."windowAt" < NOW() - INTERVAL '15 minutes' THEN 1 ELSE "LoginAttempt".attempts + 1 END,
    "windowAt" = CASE WHEN "LoginAttempt"."windowAt" < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE "LoginAttempt"."windowAt" END
    RETURNING attempts`;
  return rows[0].attempts <= limit;
}
