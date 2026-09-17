import { manualFallback } from "@/lib/lead-sources/execution";
import { sourceRoute } from "@/lib/lead-sources/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  return sourceRoute(request, (await context.params).jobId, manualFallback);
}
