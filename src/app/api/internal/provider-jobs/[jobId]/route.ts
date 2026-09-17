import { getSourceJob } from "@/lib/lead-sources/execution";
import { sourceRoute } from "@/lib/lead-sources/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  return sourceRoute(request, (await context.params).jobId, getSourceJob);
}
