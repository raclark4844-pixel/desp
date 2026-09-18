import Link from "next/link";
export function FinanceNav() {
  return (
    <nav className="employee-nav">
      <Link href="/operations">Operations</Link>
      <Link href="/customers">Customers</Link>
      <Link href="/campaign-history">Campaign history</Link>
      <Link href="/campaign-costs">Campaign costs</Link>
      <Link href="/billing">Invoices</Link>
    </nav>
  );
}
