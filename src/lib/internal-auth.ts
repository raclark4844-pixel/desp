import { timingSafeEqual } from "node:crypto";

export function isAuthorizedInternalRequest(request: Request) {
  const expected = process.env.APS_INTERNAL_API_KEY;
  const provided = request.headers.get("x-aps-internal-key");

  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
