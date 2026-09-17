import { z } from "zod";
import { importManualPage } from "@/lib/lead-sources/execution";
import { sourceRoute, boundedJson } from "@/lib/lead-sources/http";
export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(100),
    records: z.array(z.unknown()).max(100),
    final: z.boolean().default(false),
  })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  return sourceRoute(request, (await context.params).jobId, async (id) => {
    const body = schema.parse(await boundedJson(request));
    return importManualPage(id, body.idempotencyKey, body.records, body.final);
  });
}
