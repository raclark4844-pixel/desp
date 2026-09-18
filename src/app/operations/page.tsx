import { requireEmployeePage } from "@/lib/employee/page";
import Link from "next/link";
import type { Metadata } from "next";
import Operations from "./operations";
export const metadata: Metadata = {
  title: "Operations",
  robots: { index: false, follow: false },
};
export default async function OperationsPage() {
  const employee = await requireEmployeePage();
  return (
    <>
      <div className="page-shell" style={{ paddingBottom: 0 }}>
        <nav className="employee-nav">
          <span>Signed in as {employee.name}</span>
          <Link href="/customers">Customers</Link>
          <Link href="/sending">Campaign sending</Link>
          <Link href="/account">My account</Link>
          {employee.isAdmin && (
            <Link href="/admin/users">Manage employees</Link>
          )}
        </nav>
      </div>
      <Operations />
    </>
  );
}
