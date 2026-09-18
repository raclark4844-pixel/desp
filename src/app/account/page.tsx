import Link from "next/link";
import { Brand } from "@/components/brand";
import { EmployeeSignIn } from "@/components/employee-sign-in";
import { requireEmployeePage } from "@/lib/employee/page";
export const metadata = { title: "My account" };
export default async function Page() {
  const employee = await requireEmployeePage(true);
  return (
    <main className="page-shell">
      <Brand />
      <h1>My account</h1>
      <p>
        {employee.name} · {employee.username}
      </p>
      {employee.mustChangePassword && (
        <p className="notice">
          Choose your own password before entering the workspace.
        </p>
      )}
      <EmployeeSignIn changePassword />
      <Link href="/operations">Back to Operations</Link>
    </main>
  );
}
