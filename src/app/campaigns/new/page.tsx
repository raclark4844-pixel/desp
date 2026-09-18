import { requireEmployeePage } from "@/lib/employee/page";
import { Brand } from "@/components/brand";
import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/campaign-builder";

export const metadata: Metadata = {
  title: "Create Campaign",
  description: "Create a draft AP Spartan lead-generation campaign with industry-specific targeting and territories.",
};

export default async function NewCampaignPage() {
  await requireEmployeePage();
  return (
    <main className="page-shell">
      <Brand />
      <section className="hero-panel">
        <div>
          <h1>Create a campaign draft</h1>
          <p className="hero-copy">
            Define the customer, industry, territory, lead volume, targeting criteria, and requested communication channels.
            Submitting this form saves a draft only; no paid data sourcing or outreach begins here.
          </p>
        </div>
        <div className="status-card" aria-label="Campaign workflow status">
          <span className="status-dot" />
          <div>
            <strong>Draft only</strong>
            <p>Customer lookup + campaign builder</p>
          </div>
        </div>
      </section>

      <CampaignBuilder />
    </main>
  );
}
