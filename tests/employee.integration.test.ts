import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/employee/password";
import { employeeFromRequest } from "../src/lib/employee/auth";
import {
  POST as login,
  DELETE as logout,
} from "../src/app/api/employee/session/route";
import {
  POST as users,
  GET as listUsers,
} from "../src/app/api/employee/users/route";
import { POST as changePassword } from "../src/app/api/employee/password/route";
import { GET as customers } from "../src/app/api/internal/customers/route";
const origin = "https://example.invalid";
function request(path: string, body?: object, cookie = "") {
  return new Request(origin + path, {
    method: body ? "POST" : "GET",
    headers: { origin, cookie, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function cookie(response: Response) {
  return response.headers.get("set-cookie")!.split(";")[0];
}
test(
  "employee login, first-use reset, admin controls and session revocation",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    const prefix = `auth-${randomUUID()}`;
    const ids: string[] = [];
    const password = "Synthetic-passphrase-2026";
    try {
      const admin = await db.employee.create({
        data: {
          username: prefix,
          name: "Synthetic admin",
          email: `${prefix}@example.invalid`,
          passwordHash: await hashPassword(password),
          isAdmin: true,
          mustChangePassword: false,
        },
      });
      ids.push(admin.id);
      const logged = await login(
        request("/api/employee/session", { login: admin.email, password }),
      );
      assert.equal(logged.status, 200);
      const adminCookie = cookie(logged);
      assert.match(logged.headers.get("set-cookie")!, /HttpOnly/i);
      const created = await users(
        request(
          "/api/employee/users",
          {
            action: "create",
            username: `${prefix}-worker`,
            email: `${prefix}-worker@example.invalid`,
            name: "Synthetic worker",
            password,
            isAdmin: false,
          },
          adminCookie,
        ),
      );
      assert.equal(created.status, 200);
      const worker = (await created.json()).employee;
      ids.push(worker.id);
      assert.equal(worker.passwordHash, undefined);
      const first = await login(
        request("/api/employee/session", { login: worker.username, password }),
      );
      assert.equal(first.status, 200);
      const firstCookie = cookie(first);
      assert.equal((await first.json()).mustChangePassword, true);
      assert.equal(
        await employeeFromRequest(request("/", undefined, firstCookie)),
        null,
      );
      assert.equal(
        (
          await customers(
            request("/api/internal/customers?q=auth", undefined, firstCookie),
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await users(
            request(
              "/api/employee/users",
              {
                action: "update",
                id: admin.id,
                isAdmin: false,
                isActive: false,
              },
              firstCookie,
            ),
          )
        ).status,
        403,
      );
      const newPassword = "Synthetic-new-passphrase-2026";
      assert.equal(
        (
          await changePassword(
            request(
              "/api/employee/password",
              { currentPassword: password, password: newPassword },
              firstCookie,
            ),
          )
        ).status,
        200,
      );
      assert.equal(
        await employeeFromRequest(request("/", undefined, firstCookie), true),
        null,
      );
      assert.equal(
        (
          await login(
            request("/api/employee/session", {
              login: worker.username,
              password,
            }),
          )
        ).status,
        401,
      );
      const second = await login(
        request("/api/employee/session", {
          login: worker.username,
          password: newPassword,
        }),
      );
      assert.equal(second.status, 200);
      const workerCookie = cookie(second);
      assert.equal(
        (await employeeFromRequest(request("/", undefined, workerCookie)))?.id,
        worker.id,
      );
      assert.equal(
        (
          await listUsers(
            request("/api/employee/users", undefined, workerCookie),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await customers(
            request("/api/internal/customers?q=a", undefined, workerCookie),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await users(
            request(
              "/api/employee/users",
              {
                action: "update",
                id: admin.id,
                isActive: false,
                isAdmin: false,
              },
              adminCookie,
            ),
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await users(
            request(
              "/api/employee/users",
              { action: "reset", id: worker.id, password },
              adminCookie,
            ),
          )
        ).status,
        200,
      );
      assert.equal(
        await employeeFromRequest(request("/", undefined, workerCookie)),
        null,
      );
      assert.equal(
        (
          await users(
            request(
              "/api/employee/users",
              {
                action: "update",
                id: worker.id,
                isActive: false,
                isAdmin: false,
              },
              adminCookie,
            ),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await login(
            request("/api/employee/session", {
              login: worker.username,
              password,
            }),
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await logout(
            new Request(origin + "/api/employee/session", {
              method: "DELETE",
              headers: { origin, cookie: adminCookie },
            }),
          )
        ).status,
        200,
      );
      assert.equal(
        await employeeFromRequest(request("/", undefined, adminCookie)),
        null,
      );
    } finally {
      await db.auditEvent.deleteMany({
        where: { actorType: "EMPLOYEE", actorId: { in: ids } },
      });
      await db.employee.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
    }
  },
);
