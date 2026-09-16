import { NextResponse } from "next/server";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { getLeadSourceProviderStatus } from "@/lib/lead-sources/registry";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorizedInternalRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    providers: getLeadSourceProviderStatus(),
  });
}
