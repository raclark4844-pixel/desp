import Link from "next/link";
import { Brand } from "@/components/brand";
import { CustomerProfileForm } from "@/components/customer-profile-form";
import { requireEmployeePage } from "@/lib/employee/page";
import { editableProfile } from "@/lib/customer-profile";
export const metadata = { title: "Add customer" };
export default async function Page() {
  await requireEmployeePage();
  return <main className="page-shell"><Brand /><nav className="employee-nav"><Link href="/customers">← Customer database</Link><Link href="/operations">Operations</Link></nav><h1>Add customer</h1><p>Any signed-in employee can add a customer. Enter what you know now and fill in the remaining details later.</p><CustomerProfileForm create customer={{ id: "", name: "", websiteUrl: "", contactName: "", contactEmail: "", timezone: "America/New_York", updatedAt: "", profile: editableProfile(null) }} /></main>;
}
