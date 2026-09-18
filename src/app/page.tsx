import Link from "next/link";
import { Brand } from "@/components/brand";

export default function HomePage() {
  return (
    <main className="page-shell">
      <Brand />
      <nav className="employee-nav" aria-label="Main navigation">
        <Link href="/login" className="primary-button">Log in</Link>
        <Link href="/customers">Customer database</Link>
        <Link href="/operations">Operations</Link>
      </nav>
      <section className="form-section">
        <p className="eyebrow">AP SPARTAN EMPLOYEE WORKSPACE</p>
        <h1>Your customers. Your campaigns.</h1>
        <p className="hero-copy">Sign in to find saved customer information, create campaign drafts, and review your lead engine.</p>
        <div className="home-actions">
          <Link href="/customers">Open customer database →</Link>
          <Link href="/campaigns/new">Create a campaign →</Link>
        </div>
        <p className="microcopy">Customer information is available only after employee sign-in.</p>
      </section>
    </main>
  );
}
