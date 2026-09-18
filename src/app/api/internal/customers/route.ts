import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { sessionFromRequest } from "@/lib/operations/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, x-aps-internal-key",
};
export async function GET(request: Request) {
  if (!sessionFromRequest(request) && !isAuthorizedInternalRequest(request)) {
    return NextResponse.json(
      { error: "Sign in to Operations to search saved customers." },
      { status: 401, headers },
    );
  }
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 100)
    return NextResponse.json({ customers: [] }, { headers });
  try {
    const customers = await db.customer.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 10,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        websiteUrl: true,
        timezone: true,
        contactName: true,
        contactEmail: true,
      },
    });
    return NextResponse.json({ customers }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Customer search is unavailable. Please try again." },
      { status: 503, headers },
    );
  }
}
