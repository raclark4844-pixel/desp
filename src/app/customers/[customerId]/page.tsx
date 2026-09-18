import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireEmployeePage } from "@/lib/employee/page";
import { db } from "@/lib/db";
import { Brand } from "@/components/brand";
import { CustomerProfileForm } from "@/components/customer-profile-form";
import { editableProfile } from "@/lib/customer-profile";
export const metadata = { title: "Customer profile" };
export default async function Page({ params }: { params: Promise<{ customerId: string }> }) {
  await requireEmployeePage(); const { customerId } = await params;
  if (!z.string().uuid().safeParse(customerId).success) notFound();
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) notFound();
  const profile = customer.profile && typeof customer.profile === "object" && !Array.isArray(customer.profile) ? customer.profile : {};
  const source = typeof profile.sourceUrl === "string" && /^https?:\/\//i.test(profile.sourceUrl) ? profile.sourceUrl : null;
  return <main className="page-shell"><Brand /><nav className="employee-nav"><Link href="/customers">← Customer database</Link><Link href="/campaigns/new">Create a campaign</Link><Link href="/operations">Operations</Link></nav><h1>{customer.name}</h1><p>Customer ID: {customer.id}</p>{source && <p>Initial business information imported from <a href={source} target="_blank" rel="noopener noreferrer">the company website</a>{typeof profile.importedAt === "string" ? ` on ${profile.importedAt.slice(0, 10)}` : ""}. Review and update the fields below.</p>}<CustomerProfileForm customer={{ id: customer.id, name: customer.name, websiteUrl: customer.websiteUrl, contactName: customer.contactName, contactEmail: customer.contactEmail, timezone: customer.timezone, updatedAt: customer.updatedAt.toISOString(), profile: editableProfile(customer.profile) }} /></main>;
}
