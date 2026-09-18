import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { boundedJson } from "@/lib/lead-sources/http";
import { employeeRoute, EmployeeError } from "@/lib/employee/http";
import {
  employeeFromRequest,
  throttle,
  EMPLOYEE_COOKIE,
} from "@/lib/employee/auth";
import { checkPassword, hashPassword } from "@/lib/employee/password";
export const runtime = "nodejs";
export function POST(request: Request) {
  return employeeRoute(request, async () => {
    const employee = await employeeFromRequest(request, true);
    if (!employee) throw new EmployeeError(401, "Please sign in.");
    if (!(await throttle(`password:${employee.id}`, 8)))
      throw new EmployeeError(429, "Too many attempts. Wait 15 minutes.");
    const input = z
      .object({
        currentPassword: z.string().min(1).max(128),
        password: z.string().min(12).max(128),
      })
      .parse(await boundedJson(request));
    if (input.password === input.currentPassword)
      throw new EmployeeError(400, "Choose a different password.");
    const current = await db.employee.findUniqueOrThrow({
      where: { id: employee.id },
    });
    if (!(await checkPassword(input.currentPassword, current.passwordHash)))
      throw new EmployeeError(400, "Current password was not accepted.");
    const passwordHash = await hashPassword(input.password);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employee.id}::uuid FOR UPDATE`;
      const latest = await tx.employee.findUniqueOrThrow({
        where: { id: employee.id },
      });
      if (!latest.isActive || latest.passwordHash !== current.passwordHash)
        throw new EmployeeError(409, "Account changed. Please sign in again.");
      await tx.employee.update({
        where: { id: employee.id },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.employeeSession.deleteMany({
        where: { employeeId: employee.id },
      });
      await tx.auditEvent.create({
        data: {
          eventType: "employee.password_changed",
          actorType: "EMPLOYEE",
          actorId: employee.id,
        },
      });
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(EMPLOYEE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  });
}
