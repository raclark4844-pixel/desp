import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { boundedJson } from "@/lib/lead-sources/http";
import { employeeRoute, EmployeeError } from "@/lib/employee/http";
import { employeeFromRequest, employeeView } from "@/lib/employee/auth";
import { hashPassword } from "@/lib/employee/password";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const create = z
  .object({
    action: z.literal("create"),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,49}$/),
    email: z.string().trim().toLowerCase().email().max(320),
    name: z.string().trim().min(2).max(120),
    password: z.string().min(12).max(128),
    isAdmin: z.boolean().default(false),
  })
  .strict();
const update = z
  .object({
    action: z.literal("update"),
    id: z.string().uuid(),
    isActive: z.boolean(),
    isAdmin: z.boolean(),
  })
  .strict();
const reset = z
  .object({
    action: z.literal("reset"),
    id: z.string().uuid(),
    password: z.string().min(12).max(128),
  })
  .strict();
export function GET(request: Request) {
  return employeeRoute(request, async () => {
    const actor = await employeeFromRequest(request);
    if (!actor?.isAdmin)
      throw new EmployeeError(403, "Administrator access required.");
    return NextResponse.json({
      employees: await db.employee.findMany({
        select: employeeView,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 500,
      }),
      currentId: actor.id,
    });
  });
}
export function POST(request: Request) {
  return employeeRoute(request, async () => {
    const actor = await employeeFromRequest(request);
    if (!actor?.isAdmin)
      throw new EmployeeError(403, "Administrator access required.");
    const input = z
      .discriminatedUnion("action", [create, update, reset])
      .parse(await boundedJson(request));
    if (input.action !== "create" && input.id === actor.id)
      throw new EmployeeError(
        400,
        "Use My account for your password. You cannot disable or change your own administrator role.",
      );
    const passwordHash =
      input.action === "update"
        ? undefined
        : await hashPassword(input.password);
    try {
      const employee = await db.$transaction(async (tx) => {
        // Serialize account administration and recheck the administrator inside the transaction.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(18375412)`;
        const latestActor = await tx.employee.findUnique({
          where: { id: actor.id },
        });
        if (
          !latestActor?.isAdmin ||
          !latestActor.isActive ||
          latestActor.mustChangePassword
        )
          throw new EmployeeError(403, "Administrator access required.");
        const employee =
          input.action === "create"
            ? await tx.employee.create({
                data: {
                  username: input.username,
                  email: input.email,
                  name: input.name,
                  isAdmin: input.isAdmin,
                  passwordHash: passwordHash!,
                  mustChangePassword: true,
                },
                select: employeeView,
              })
            : await tx.employee.update({
                where: { id: input.id },
                data:
                  input.action === "reset"
                    ? { passwordHash, mustChangePassword: true }
                    : { isActive: input.isActive, isAdmin: input.isAdmin },
                select: employeeView,
              });
        if (input.action !== "create")
          await tx.employeeSession.deleteMany({
            where: { employeeId: employee.id },
          });
        await tx.auditEvent.create({
          data: {
            eventType: `employee.${input.action}`,
            actorType: "EMPLOYEE",
            actorId: actor.id,
            payload: {
              employeeId: employee.id,
              isAdmin: employee.isAdmin,
              isActive: employee.isActive,
            },
          },
        });
        return employee;
      });
      return NextResponse.json({ ok: true, employee });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        if (error.code === "P2002")
          throw new EmployeeError(
            409,
            "That username or email is already registered.",
          );
        if (error.code === "P2025")
          throw new EmployeeError(404, "Employee was not found.");
      }
      throw error;
    }
  });
}
