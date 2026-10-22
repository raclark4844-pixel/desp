import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { boundedJson } from "@/lib/lead-sources/http";
import { customerStatusChangeSchema } from "@/lib/customer-status";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403, headers });

  const employee = await employeeFromRequest(request);
  if (!employee)
    return NextResponse.json({ error: "Employee sign-in required." }, { status: 401, headers });
  if (!employee.isAdmin)
    return NextResponse.json({ error: "Administrator access is required." }, { status: 403, headers });

  const { customerId } = await params;
  if (!z.string().uuid().safeParse(customerId).success)
    return NextResponse.json({ error: "Customer not found." }, { status: 404, headers });

  try {
    const input = customerStatusChangeSchema.parse(await boundedJson(request));
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId}::uuid FOR UPDATE`;
      const existing = await tx.customer.findUnique({ where: { id: customerId } });
      if (!existing) return { statusCode: 404, error: "Customer not found." };
      if (existing.updatedAt.toISOString() !== input.updatedAt)
        return { statusCode: 409, error: "This customer was updated elsewhere. Reload before changing status." };

      if (existing.status === input.status)
        return {
          statusCode: 200,
          status: existing.status,
          updatedAt: existing.updatedAt.toISOString(),
          pausedCampaigns: 0,
        };

      const customer = await tx.customer.update({
        where: { id: customerId },
        data: { status: input.status },
      });

      let pausedCampaigns = 0;
      if (input.status !== "ACTIVE") {
        const paused = await tx.campaign.updateMany({
          where: { customerId, status: { in: ["READY", "RUNNING"] } },
          data: { status: "PAUSED" },
        });
        pausedCampaigns = paused.count;
      }

      await tx.auditEvent.create({
        data: {
          customerId,
          eventType: "customer.status_changed",
          actorType: "EMPLOYEE",
          actorId: employee.id,
          payload: {
            previousStatus: existing.status,
            status: input.status,
            reason: input.reason,
            pausedCampaigns,
          },
        },
      });

      return {
        statusCode: 200,
        status: customer.status,
        updatedAt: customer.updatedAt.toISOString(),
        pausedCampaigns,
      };
    });

    if ("error" in result)
      return NextResponse.json({ error: result.error }, { status: result.statusCode, headers });

    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ZodError ? "Check the selected status and reason." : "Unable to change customer status." },
      { status: error instanceof ZodError ? 400 : 503, headers },
    );
  }
}
