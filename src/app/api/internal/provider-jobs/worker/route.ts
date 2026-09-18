import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { executeSourceJob } from "@/lib/lead-sources/execution";
import { runEnrichmentWorker } from "@/lib/enrichment/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function cronAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET,
    provided = request.headers.get("authorization");
  if (!expected || !provided) return false;
  const a = Buffer.from(`Bearer ${expected}`),
    b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function run() {
  try {
    const now = new Date();
    const job = await db.providerJob.findFirst({
      where: {
        jobType: { in: ["SOURCE_LEADS", "SOURCE_LEADS_MANUAL"] },
        campaign: {
          status: { in: ["READY", "RUNNING"] },
          customer: { status: "ACTIVE" },
        },
        OR: [
          {
            status: "QUEUED",
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { status: "RUNNING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const result = job
      ? await executeSourceJob(job.id)
      : (await runEnrichmentWorker()).job;
    return NextResponse.json(
      { ok: true, result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "WORKER_FAILED" },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request))
    return NextResponse.json({ ok: false }, { status: 401 });
  return run();
}
export async function GET(request: Request) {
  if (!cronAuthorized(request))
    return NextResponse.json({ ok: false }, { status: 401 });
  return run();
}
