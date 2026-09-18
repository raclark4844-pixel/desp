import { z } from "zod";
import { reviewRoute } from "@/lib/operations/review-http";
import { recordEvidence } from "@/lib/compliance/service";
import { evidenceSchema } from "@/lib/compliance/policy";
import { boundedJson } from "@/lib/lead-sources/http";
const submission = z
  .object({ acknowledged: z.literal(true), evidence: evidenceSchema })
  .strict();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return reviewRoute(
    request,
    async () => {
      const body = submission.parse(await boundedJson(request));
      return recordEvidence(body.evidence);
    },
    true,
  );
}
