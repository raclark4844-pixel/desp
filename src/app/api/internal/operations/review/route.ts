import { reviewRoute } from "@/lib/operations/review-http";
import { listReviewContacts } from "@/lib/operations/review";
import { evaluateReadiness } from "@/lib/compliance/service";
import { boundedJson } from "@/lib/lead-sources/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return reviewRoute(request, () =>
    listReviewContacts(Object.fromEntries(new URL(request.url).searchParams)),
  );
}
export async function POST(request: Request) {
  return reviewRoute(request, async () =>
    evaluateReadiness(await boundedJson(request)),
  );
}
