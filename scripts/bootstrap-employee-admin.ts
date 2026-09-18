// Run only from an authorized operator environment. Never log the generated password.
import { randomBytes } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/employee/password";
const email = process.env.AP_ADMIN_EMAIL?.trim().toLowerCase();
const username = process.env.AP_ADMIN_USERNAME?.trim().toLowerCase();
const name = process.env.AP_ADMIN_NAME?.trim();
const output = process.env.AP_ADMIN_ACCESS_FILE;
if (!email || !username || !name || !output || !isAbsolute(output))
  throw new Error(
    "Provide administrator identity and an absolute private output file path.",
  );
const password = randomBytes(24).toString("base64url");
let wroteFile = false;
try {
  if (await db.employee.findFirst({ where: { OR: [{ email }, { username }] } }))
    throw new Error("Administrator already exists; no changes made.");
  const passwordHash = await hashPassword(password);
  await writeFile(
    output,
    `AP Spartan administrator access\n\nSign in: https://desp-omega.vercel.app/login\nName: ${name}\nUser ID: ${username}\nEmail: ${email}\nTemporary password: ${password}\n\nOn first sign-in, choose your own password, then sign in again.\nUse Manage employees to create user IDs and temporary passwords.\nKeep this file private and delete it after changing the temporary password.\n`,
    { mode: 0o600, flag: "wx" },
  );
  wroteFile = true;
  await db.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        email,
        username,
        name,
        passwordHash,
        isAdmin: true,
        mustChangePassword: true,
      },
    });
    await tx.auditEvent.create({
      data: {
        eventType: "employee.admin_bootstrapped",
        actorType: "AUTHORIZED_OPERATOR",
        actorId: employee.id,
      },
    });
  });
  console.log(
    "Administrator created. Temporary credentials saved in the private local file; password change required.",
  );
} catch (error) {
  if (wroteFile) await unlink(output);
  throw error;
} finally {
  await db.$disconnect();
}
