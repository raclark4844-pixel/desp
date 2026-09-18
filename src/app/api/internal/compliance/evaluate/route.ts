import { complianceRoute } from "@/lib/compliance/http";
import { evaluateReadiness } from "@/lib/compliance/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return complianceRoute(request, evaluateReadiness);
}
