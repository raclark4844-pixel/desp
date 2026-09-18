import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
export const SESSION_COOKIE = "aps_operations";
export const SESSION_SECONDS = 1800;
function sign(payload: string, key: string) {
  return createHmac("sha256", key)
    .update(`aps-operations-v1:${payload}`)
    .digest("base64url");
}
export function createSession(now = Date.now()) {
  const key = process.env.APS_INTERNAL_API_KEY;
  if (!key) throw new Error("ACCESS_NOT_CONFIGURED");
  const payload = Buffer.from(
    JSON.stringify({
      expires: now + SESSION_SECONDS * 1000,
      nonce: randomUUID(),
      scope: "operations-read",
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}
export function validSession(token: string | undefined, now = Date.now()) {
  const key = process.env.APS_INTERNAL_API_KEY;
  if (!key || !token || token.length > 1024) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expected = Buffer.from(sign(parts[0], key));
  const provided = Buffer.from(parts[1]);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  )
    return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return (
      data.scope === "operations-read" &&
      Number.isSafeInteger(data.expires) &&
      data.expires > now &&
      data.expires <= now + SESSION_SECONDS * 1000
    );
  } catch {
    return false;
  }
}
export function sessionFromRequest(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return validSession(token);
}
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
