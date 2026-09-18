import { queueLock } from "../outreach/service";
import { db } from "../db";
import { sessionToken } from "../employee/auth";
import { digest } from "../employee/password";
import { fail } from "./senders";
export function sessionHash(request: Request) {
  const token = sessionToken(request);
  return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : "";
}
export const aiConfigured = () =>
  process.env.INBOX_AI_ENABLED === "true" &&
  !!process.env.OPENAI_API_KEY &&
  !!process.env.INBOX_AI_MODEL;
export async function requireAiSession(
  hash: string,
  employeeId: string,
  version?: number,
) {
  const s = hash
    ? await db.employeeSession.findUnique({
        where: { tokenHash: hash },
        include: { employee: true },
      })
    : null;
  if (
    !s ||
    s.employeeId !== employeeId ||
    !s.employee.isActive ||
    s.employee.mustChangePassword ||
    s.expiresAt <= new Date() ||
    !s.aiEnabled ||
    !s.aiEnabledAt ||
    (version !== undefined && s.aiVersion !== version)
  )
    fail(
      "AI monitoring is not authorized for this login session. Confirm in AI session settings first.",
    );
  return s!;
}
export async function aiSessionView(hash: string, employeeId: string) {
  const s = await db.employeeSession.findUniqueOrThrow({
    where: { tokenHash: hash },
  });
  if (s.employeeId !== employeeId || s.expiresAt <= new Date())
    fail("Sign in again.");
  return {
    decided: !!s.aiDecidedAt,
    enabled: s.aiEnabled,
    configured: !!aiConfigured(),
    expiresAt: s.expiresAt,
    reviewed: await db.aiObservation.count({
      where: {
        employeeId,
        createdAt: { gte: s.aiEnabledAt ?? new Date() },
        status: "COMPLETE",
      },
    }),
  };
}
export async function setAiSession(
  hash: string,
  employeeId: string,
  enabled: boolean,
) {
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const s = await tx.employeeSession.findUniqueOrThrow({
      where: { tokenHash: hash },
    });
    if (s.employeeId !== employeeId || s.expiresAt <= new Date())
      fail("Sign in again.");
    await tx.employeeSession.update({
      where: { tokenHash: hash },
      data: {
        aiEnabled: enabled,
        aiDecidedAt: new Date(),
        aiEnabledAt: enabled ? new Date() : null,
        aiVersion: { increment: 1 },
      },
    });
    await tx.auditEvent.create({
      data: {
        eventType: enabled
          ? "employee.ai_session_confirmed"
          : "employee.ai_session_disabled",
        actorType: "EMPLOYEE",
        actorId: employeeId,
        payload: {
          disclosureVersion: "2026-09-session-v1",
          mode: "MONITOR_AND_DRAFT",
          modelTraining: false,
          automaticSending: false,
        },
      },
    });
  });
}
