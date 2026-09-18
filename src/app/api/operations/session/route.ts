import { NextResponse } from "next/server";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import {
  createSession,
  sameOrigin,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "@/lib/operations/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { ok: false, error: "Request origin rejected." },
      { status: 403, headers },
    );
  if (!isAuthorizedInternalRequest(request))
    return NextResponse.json(
      { ok: false, error: "Access key not accepted." },
      { status: 401, headers },
    );
  const response = NextResponse.json({ ok: true }, { headers });
  response.cookies.set(SESSION_COOKIE, createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return response;
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ ok: false }, { status: 403, headers });
  const response = NextResponse.json({ ok: true }, { headers });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
