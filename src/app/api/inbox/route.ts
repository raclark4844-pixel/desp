import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { boundedJson } from "@/lib/lead-sources/http";
import { SourceError } from "@/lib/lead-sources/contract";
import {
  overview,
  detail,
  updateConversation,
  saveReply,
  sendReply,
  saveTarget,
  saveKnowledge,
} from "@/lib/inbox/service";
import { assignSender, registerSender } from "@/lib/inbox/senders";
import { suggestReply } from "@/lib/inbox/ai";
import { db } from "@/lib/db";
import { audit, queueLock } from "@/lib/outreach/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function route(request: Request) {
  const employee = await employeeFromRequest(request);
  if (!employee)
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401, headers },
    );
  if (request.method !== "GET" && !sameOrigin(request))
    return NextResponse.json(
      { error: "Request origin rejected." },
      { status: 403, headers },
    );
  try {
    let result: unknown;
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams;
      result = query.get("id")
        ? await detail(query.get("id")!)
        : await overview(
            query.get("campaign") || undefined,
            query.get("cursor") || undefined,
          );
    } else {
      const { action, payload } = z
        .object({
          action: z.enum([
            "ASSIGN",
            "DRAFT",
            "SEND",
            "AI",
            "TARGET",
            "KNOWLEDGE",
            "RETIRE_KNOWLEDGE",
            "REGISTER_SENDER",
            "ASSIGN_SENDER",
          ]),
          payload: z.unknown(),
        })
        .strict()
        .parse(await boundedJson(request));
      if (
        [
          "TARGET",
          "KNOWLEDGE",
          "RETIRE_KNOWLEDGE",
          "REGISTER_SENDER",
          "ASSIGN_SENDER",
        ].includes(action) &&
        !employee.isAdmin
      )
        return NextResponse.json(
          { error: "Administrator access required." },
          { status: 403, headers },
        );
      switch (action) {
        case "ASSIGN":
          result = await updateConversation(payload, employee.id);
          break;
        case "DRAFT":
          result = await saveReply(payload, employee.id);
          break;
        case "SEND":
          result = await sendReply(payload, employee.id);
          break;
        case "AI":
          result = await suggestReply(payload, employee.id);
          break;
        case "TARGET":
          result = await saveTarget(payload, employee.id);
          break;
        case "KNOWLEDGE":
          result = await saveKnowledge(payload, employee.id);
          break;
        case "REGISTER_SENDER":
          result = await registerSender(payload, employee.id);
          break;
        case "ASSIGN_SENDER":
          result = await assignSender(payload, employee.id);
          break;
        case "RETIRE_KNOWLEDGE": {
          const { id } = z
            .object({ id: z.string().uuid() })
            .strict()
            .parse(payload);
          await db.$transaction(async (tx) => {
            await queueLock(tx);
            const k = await tx.replyKnowledge.update({
              where: { id },
              data: { active: false },
            });
            await audit(tx, k.campaignId, "knowledge_retired", employee.id, {
              knowledgeId: id,
            });
          });
          break;
        }
      }
    }
    return NextResponse.json({ result: result ?? null }, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SourceError
            ? error.code
            : error instanceof ZodError
              ? error.issues.map((i) => i.message).join(" ")
              : "Inbox unavailable. Please refresh and try again.",
      },
      {
        status:
          error instanceof SourceError
            ? 409
            : error instanceof ZodError
              ? 400
              : 503,
        headers,
      },
    );
  }
}
export const GET = route;
export const POST = route;
