import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEmployeePage } from "@/lib/employee/page";
import { Brand } from "@/components/brand";
import { FinanceNav } from "@/components/finance-nav";
import { invoiceText } from "@/lib/billing/service";
export const dynamic = "force-dynamic";
export default async function Invoice({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireEmployeePage();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const invoice = await db.billingInvoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: [{ campaignName: "asc" }, { sentAt: "asc" }] },
    },
  });
  if (!invoice) notFound();
  return (
    <main className="page-shell">
      <Brand />
      <FinanceNav />
      <h1>{invoice.number}</h1>
      <p>
        Email status: {invoice.status} · {invoice.reason}
      </p>
      <p>Recipients: {invoice.recipients.join(", ")}</p>
      <p>Sent: {invoice.sentAt?.toLocaleString() || "Not sent"}</p>
      <pre className="billing-summary">{invoiceText(invoice)}</pre>
    </main>
  );
}
