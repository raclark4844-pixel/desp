import Link from "next/link";
import { Brand } from "@/components/brand";
import { EmployeeUsers } from "@/components/employee-users";
import { requireEmployeePage } from "@/lib/employee/page";
export const metadata = { title: "Manage employees" };
export default async function Page() {
  await requireEmployeePage(false, true);
  return (
    <main className="page-shell">
      <Brand />
      <Link href="/operations">← Operations</Link>
      <h1>Manage employees</h1>
      <EmployeeUsers />
    </main>
  );
}
