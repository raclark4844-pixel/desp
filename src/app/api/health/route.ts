import { NextResponse } from "next/server";
import { databaseConfigured, db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET() {
  if (!databaseConfigured) {
    return NextResponse.json(
      {
        ok: false,
        service: "aps-lead-engine",
        database: "not_configured",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        ok: true,
        service: "aps-lead-engine",
        database: "connected",
        version: "0.8.0",
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json(
      {
        ok: false,
        service: "aps-lead-engine",
        database: "unavailable",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
