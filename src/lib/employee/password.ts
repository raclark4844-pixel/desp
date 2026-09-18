import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function passwordValid(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
function derive(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string) {
  if (!passwordValid(password))
    throw new Error("Password must contain 12–128 characters.");
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function checkPassword(password: string, encoded?: string) {
  const parts = encoded?.split("$");
  const valid =
    parts?.length === 3 &&
    parts[0] === "scrypt-v1" &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2]);
  const key = await derive(password, valid ? parts[1] : "0".repeat(32));
  return !!valid && timingSafeEqual(key, Buffer.from(parts[2], "hex"));
}
