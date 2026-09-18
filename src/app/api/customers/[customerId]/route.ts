import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { boundedJson } from "@/lib/lead-sources/http";
import { customerUpdateSchema } from "@/lib/customer-profile";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin rejected." }, { status: 403, headers });
  const employee = await employeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Employee sign-in required." }, { status: 401, headers });
  const { customerId } = await params;
  if (!z.string().uuid().safeParse(customerId).success) return NextResponse.json({ error: "Customer not found." }, { status: 404, headers });
  try {
    const input = customerUpdateSchema.parse(await boundedJson(request));
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId}::uuid FOR UPDATE`;
      const existing = await tx.customer.findUnique({ where: { id: customerId } });
      if (!existing) return { status: 404, error: "Customer not found." };
      if (existing.updatedAt.toISOString() !== input.updatedAt) return { status: 409, error: "This customer was updated elsewhere. Reload before editing again." };
      const previous = existing.profile && typeof existing.profile === "object" && !Array.isArray(existing.profile) ? existing.profile : {};
      const customer = await tx.customer.update({ where: { id: customerId }, data: { name: input.name, websiteUrl: input.websiteUrl || null, contactName: input.contactName || null, contactEmail: input.contactEmail.toLowerCase() || null, timezone: input.timezone, profile: { ...previous, ...input.profile } } });
      await tx.auditEvent.create({ data: { customerId, eventType: "customer.profile_updated", actorType: "EMPLOYEE", actorId: employee.id, payload: { source: "customer-profile-editor" } } });
      return { status: 200, updatedAt: customer.updatedAt.toISOString() };
    });
    return NextResponse.json(result, { status: result.status, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ZodError ? "Check the entered fields and website/email format." : "Unable to save customer. Please try again." }, { status: error instanceof ZodError ? 400 : 503, headers });
  }
}
