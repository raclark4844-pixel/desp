import { NextResponse } from "next/server";
import { databaseConfigured, db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!databaseConfigured) {
    return NextResponse.json(
      {
        ok: false,
        service: "aps-lead-engine",
        database: "not_configured",
      },
      { status: 503 },
    );
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      service: "aps-lead-engine",
      database: "connected",
    });
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json(
      {
        ok: false,
        service: "aps-lead-engine",
        database: "unavailable",
      },
      { status: 503 },
    );
  }
}
