import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { SourceError } from "./contract";
export async function sourceRoute(
  request: Request,
  id: string,
  run: (id: string) => Promise<unknown>,
) {
  if (!isAuthorizedInternalRequest(request))
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  if (!z.string().uuid().safeParse(id).success)
    return NextResponse.json(
      { ok: false, error: "INVALID_JOB_ID" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      { ok: true, result: await run(id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const code =
      e instanceof SourceError
        ? e.code
        : e instanceof ZodError
          ? "INVALID_IMPORT"
          : "SOURCE_REQUEST_FAILED";
    return NextResponse.json(
      { ok: false, error: code },
      {
        status:
          code === "JOB_NOT_FOUND"
            ? 404
            : e instanceof ZodError
              ? 400
              : e instanceof SourceError
                ? 409
                : 500,
      },
    );
  }
}
export async function boundedJson(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 262144)
    throw new SourceError("BODY_TOO_LARGE", "failed");
  const reader = request.body?.getReader();
  if (!reader) throw new SourceError("INVALID_BODY", "failed");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 262144) {
      await reader.cancel();
      throw new SourceError("BODY_TOO_LARGE", "failed");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SourceError("INVALID_JSON", "failed");
  }
}
