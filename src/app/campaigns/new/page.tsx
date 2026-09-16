import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/campaign-builder";

export const metadata: Metadata = {
  title: "Create Campaign",
  description: "Create a draft APS lead-generation campaign with industry-specific targeting and territories.",
};

export default function NewCampaignPage() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">APS LEAD ENGINE</p>
          <h1>Create a campaign draft</h1>
          <p className="hero-copy">
            Define the customer, industry, territory, lead volume, targeting criteria, and requested communication channels.
            Submitting this form saves a draft only; no paid data sourcing or outreach begins here.
          </p>
        </div>
        <div className="status-card" aria-label="Campaign workflow status">
          <span className="status-dot" />
          <div>
            <strong>Step 2 active</strong>
            <p>Campaign Builder + orchestration foundation</p>
          </div>
        </div>
      </section>

      <CampaignBuilder />
    </main>
  );
}
