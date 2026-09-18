import { NextResponse } from "next/server";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { runEnrichmentWorker } from "@/lib/enrichment/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request))
    return NextResponse.json({ ok: false }, { status: 401 });
  try {
    return NextResponse.json(
      { ok: true, result: await runEnrichmentWorker() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "ENRICHMENT_WORKER_FAILED" },
      { status: 500 },
    );
  }
}
