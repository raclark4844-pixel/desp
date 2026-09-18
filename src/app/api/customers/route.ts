import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { boundedJson } from "@/lib/lead-sources/http";
import { SourceError } from "@/lib/lead-sources/contract";
import { customerCreateSchema } from "@/lib/customer-profile";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin rejected." }, { status: 403, headers });
  const employee = await employeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Employee sign-in required." }, { status: 401, headers });
  try {
    const { requestId, ...input } = customerCreateSchema.parse(await boundedJson(request));
    const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`;
      const prior = await tx.auditEvent.findUnique({ where: { id: requestId } });
      if (prior) {
        const payload = prior.payload as { inputHash?: string } | null;
        if (prior.eventType !== "customer.created" || prior.actorId !== employee.id || payload?.inputHash !== inputHash || !prior.customerId) return { status: 409, error: "Submission changed. Reload the form before creating another customer." };
        return { status: 200, customerId: prior.customerId };
      }
      const base = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80) || "customer";
      const customer = await tx.customer.create({ data: { name: input.name, slug: `${base}-${randomUUID()}`, contactName: input.contactName || null, contactEmail: input.contactEmail.toLowerCase() || null, websiteUrl: input.websiteUrl || null, timezone: input.timezone, profile: input.profile } });
      await tx.auditEvent.create({ data: { id: requestId, customerId: customer.id, eventType: "customer.created", actorType: "EMPLOYEE", actorId: employee.id, payload: { source: "customer-profile-form", inputHash } } });
      return { status: 201, customerId: customer.id };
    });
    return NextResponse.json(result, { status: result.status, headers });
  } catch (error) {
    const invalid = error instanceof ZodError || error instanceof SourceError;
    return NextResponse.json({ error: invalid ? "Check the entered fields and website/email format." : "Unable to create customer. Please try again." }, { status: invalid ? 400 : 503, headers });
  }
}
