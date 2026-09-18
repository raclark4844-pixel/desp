import { requireEmployeePage } from "@/lib/employee/page";
import { Brand } from "@/components/brand";
import Link from "next/link";
import Inbox from "./inbox";
export const metadata = {
  title: "Campaign inbox",
  robots: { index: false, follow: false },
};
export default async function Page() {
  const employee = await requireEmployeePage();
  return (
    <main className="page-shell inbox-workspace">
      <Brand />
      <nav className="employee-nav">
        <Link href="/operations">Operations</Link>
        <Link href="/sending">Campaign sending</Link>
        <Link href="/customers">Customers</Link>
      </nav>
      <h1>Campaign inbox</h1>
      <p>Conversations, team handoffs and approved answers in one place.</p>
      <Inbox admin={employee.isAdmin} />
    </main>
  );
}
