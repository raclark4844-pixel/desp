import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { boundedJson } from "@/lib/lead-sources/http";
import { employeeRoute, EmployeeError } from "@/lib/employee/http";
import { checkPassword, digest } from "@/lib/employee/password";
import {
  employeeFromRequest,
  employeeView,
  EMPLOYEE_COOKIE,
  newSession,
  SESSION_AGE,
  sessionToken,
  throttle,
} from "@/lib/employee/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
export function GET(request: Request) {
  return employeeRoute(request, async () => {
    const employee = await employeeFromRequest(request, true);
    if (!employee) throw new EmployeeError(401, "Please sign in.");
    return NextResponse.json({ employee });
  });
}
export function POST(request: Request) {
  return employeeRoute(request, async () => {
    const input = z
      .object({
        login: z
          .string()
          .trim()
          .min(1)
          .max(320)
          .transform((v) => v.toLowerCase()),
        password: z.string().min(1).max(128),
      })
      .parse(await boundedJson(request));
    // Vercel supplies this trusted deployment header. Local development shares one bucket.
    const ip = process.env.VERCEL
      ? (request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown")
      : "local";
    if (
      !(await throttle(`login-ip:${ip}`, 30)) ||
      !(await throttle(`login-user:${input.login}`, 8))
    )
      throw new EmployeeError(
        429,
        "Too many attempts. Wait 15 minutes and try again.",
      );
    const employee = await db.employee.findFirst({
      where: { OR: [{ username: input.login }, { email: input.login }] },
    });
    const matches = await checkPassword(input.password, employee?.passwordHash);
    if (!employee?.isActive || !matches)
      throw new EmployeeError(401, "Username or password was not accepted.");
    const session = newSession();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employee.id}::uuid FOR UPDATE`;
      const current = await tx.employee.findUniqueOrThrow({
        where: { id: employee.id },
      });
      if (!current.isActive || current.passwordHash !== employee.passwordHash)
        throw new EmployeeError(401, "Please sign in again.");
      await tx.employeeSession.deleteMany({
        where: { employeeId: employee.id, expiresAt: { lte: new Date() } },
      });
      await tx.employeeSession.create({
        data: {
          tokenHash: session.tokenHash,
          employeeId: employee.id,
          expiresAt: session.expiresAt,
        },
      });
      await tx.auditEvent.create({
        data: {
          eventType: "employee.signed_in",
          actorType: "EMPLOYEE",
          actorId: employee.id,
        },
      });
    });
    const response = NextResponse.json({
      ok: true,
      mustChangePassword: employee.mustChangePassword,
    });
    response.cookies.set(EMPLOYEE_COOKIE, session.token, {
      ...cookieOptions,
      maxAge: SESSION_AGE,
    });
    return response;
  });
}
export function DELETE(request: Request) {
  return employeeRoute(request, async () => {
    const token = sessionToken(request);
    if (token && token.length <= 128)
      await db.employeeSession.deleteMany({
        where: { tokenHash: digest(token) },
      });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(EMPLOYEE_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    response.cookies.set("aps_operations", "", { ...cookieOptions, maxAge: 0 });
    return response;
  });
}
