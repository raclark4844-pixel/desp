import Link from "next/link";

const groups = [
  {
    title: "Customers and campaign databases",
    links: [
      [
        "Customer database",
        "View and update companies and their contact information.",
        "/customers",
      ],
      ["Add a customer", "Create a new customer record.", "/customers/new"],
      [
        "Create a campaign",
        "Build a campaign for a saved customer.",
        "/campaigns/new",
      ],
      [
        "Campaign history and lead records",
        "Browse campaigns by customer, run dates, sent leads and delivery details.",
        "/campaign-history",
      ],
      [
        "Lead and contact review",
        "Choose a campaign below, then open its contact review and compliance records.",
        "#campaign-records",
      ],
    ],
  },
  {
    title: "Communications and billing",
    links: [
      [
        "Campaign inbox",
        "Read conversations, draft replies and send qualified leads to campaign contacts.",
        "/inbox",
      ],
      [
        "Campaign sending",
        "Review text, email and phone campaign batches and sending readiness.",
        "/sending",
      ],
      [
        "Campaign costs",
        "View operating expenses, usage estimates and configured rates.",
        "/campaign-costs",
      ],
      [
        "Customer invoices",
        "View weekly lead summaries, $60-per-lead totals and invoice email settings.",
        "/billing",
      ],
    ],
  },
  {
    title: "Account and project status",
    links: [
      ["My account", "Manage your account and password.", "/account"],
      [
        "Operations and setup",
        "View the setup checklist, campaign jobs and recent activity below.",
        "#campaign-records",
      ],
      [
        "Database connection status",
        "Check whether the app can connect to its database.",
        "/api/health",
      ],
    ],
  },
];
const services = [
  ["GitHub · project code", "https://github.com/raclark4844-pixel/desp"],
  [
    "Vercel · hosting and configuration",
    "https://vercel.com/raclark4844-pixels-projects/desp",
  ],
  ["Neon · database administration", "https://console.neon.tech/"],
  ["BatchData · property data", "https://app.batchdata.com/dashboard"],
  ["PropWire · manual lead sourcing", "https://propwire.com/"],
  ["Twilio · texts and phone calls", "https://console.twilio.com/"],
  [
    "RealPhoneValidation · phone verification",
    "https://www.realphonevalidation.com/",
  ],
  ["FTC · Do Not Call registration", "https://telemarketing.donotcall.gov/"],
  ["Resend · email delivery setup", "https://resend.com/overview"],
  ["OpenAI · AI assistant setup", "https://platform.openai.com/"],
];
export function ProjectDirectory({ admin }: { admin: boolean }) {
  return (
    <section className="project-directory" aria-labelledby="workspace-title">
      <p className="eyebrow">AP SPARTAN · PROJECT HOME</p>
      <h1 id="workspace-title">Your workspace</h1>
      <p>
        Open every project area from here. Customer records, campaign details
        and individual invoices are available inside their databases.
      </p>
      {groups.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <div className="project-link-grid">
            {group.links.map(([name, description, href]) => (
              <Link className="project-link-card" href={href} key={name}>
                <strong>
                  {name}
                  <span aria-hidden="true"> →</span>
                </strong>
                <span>{description}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {admin && (
        <section>
          <h2>Administration</h2>
          <div className="project-link-grid">
            <Link className="project-link-card" href="/admin/users">
              <strong>Manage employees →</strong>
              <span>
                Create employee accounts, reset passwords and manage access.
              </span>
            </Link>
          </div>
          <details className="project-services">
            <summary>Connected services and provider websites</summary>
            <p>
              These open in a new tab and require their own sign-in. A listed
              service may still need configuration; this list does not mean
              sending is enabled.
            </p>
            <ul>
              {services.map(([name, url]) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {name} ↗
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </section>
  );
}
