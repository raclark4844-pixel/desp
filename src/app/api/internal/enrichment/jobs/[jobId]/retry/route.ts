import { z } from "zod";
import { retryEnrichment } from "@/lib/enrichment/service";
import { boundedJson, sourceRoute } from "@/lib/lead-sources/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  return sourceRoute(request, (await context.params).jobId, async (id) => {
    const body = z
      .object({ acknowledgePossibleCharge: z.boolean().default(false) })
      .strict()
      .parse(await boundedJson(request));
    return retryEnrichment(id, body.acknowledgePossibleCharge);
  });
}
