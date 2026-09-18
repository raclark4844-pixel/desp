import { requireEmployeePage } from "@/lib/employee/page";
import { Brand } from "@/components/brand";
import Link from "next/link";
import Sending from "./sending";
export const metadata = {
  title: "Campaign sending",
  robots: { index: false, follow: false },
};
export default async function Page() {
  const employee = await requireEmployeePage();
  return (
    <main className="page-shell sending-workspace">
      <Brand />
      <nav className="employee-nav">
        <Link href="/operations">Operations</Link>
        <Link href="/customers">Customers</Link>
        <Link href="/account">My account</Link>
      </nav>
      <h1>Campaign sending</h1>
      <p>
        Prepare texts, emails and employee-assisted calls. An administrator
        reviews and approves each batch.
      </p>
      <Sending admin={employee.isAdmin} />
    </main>
  );
}
