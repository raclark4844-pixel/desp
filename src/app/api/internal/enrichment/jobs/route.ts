import { z } from "zod";
import { queueEnrichment } from "@/lib/enrichment/service";
import { boundedJson, sourceRoute } from "@/lib/lead-sources/http";
export const runtime = "nodejs";
const schema = z
  .object({
    campaignId: z.string().uuid(),
    leadId: z.string().uuid(),
    propertyId: z.string().uuid(),
  })
  .strict();
export async function POST(request: Request) {
  return sourceRoute(
    request,
    "00000000-0000-4000-8000-000000000000",
    async () => {
      const input = schema.parse(await boundedJson(request));
      return queueEnrichment(input.campaignId, input.leadId, input.propertyId);
    },
  );
}
