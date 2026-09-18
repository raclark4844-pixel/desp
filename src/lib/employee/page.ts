import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { employeeFromRequest } from "./auth";
export async function requireEmployeePage(
  allowPasswordChange = false,
  admin = false,
) {
  const employee = await employeeFromRequest(
    new Request("https://internal.invalid", {
      headers: new Headers(await headers()),
    }),
    true,
  );
  if (!employee) redirect("/login");
  if (employee.mustChangePassword && !allowPasswordChange)
    redirect("/account?required=1");
  if (admin && !employee.isAdmin) redirect("/operations");
  return employee;
}
