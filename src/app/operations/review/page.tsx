import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import Review from "./review";
export const metadata: Metadata = {
  title: "Contact review",
  robots: { index: false, follow: false },
};
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string }>;
}) {
  const { campaignId } = await searchParams;
  if (!z.string().uuid().safeParse(campaignId).success)
    return (
      <main className="page-shell">
        <h1>Choose a campaign first.</h1>
        <Link href="/operations">Back to operations</Link>
      </main>
    );
  return <Review campaignId={campaignId!} />;
}
