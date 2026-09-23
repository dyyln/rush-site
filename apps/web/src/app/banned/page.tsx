import type { Metadata } from "next";
import { dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Account banned", robots: { index: false } };

type Props = { searchParams: Promise<{ until?: string; reason?: string }> };

// Shown instead of a session when a banned player signs in. React escapes the reason
export default async function BannedPage({ searchParams }: Props) {
  const { until, reason } = await searchParams;
  const end = until && !Number.isNaN(Date.parse(until)) ? dateTime(until) : null;
  return (
    <div className="container page">
      <h1>This account is banned</h1>
      <p>{end ? `The ban ends on ${end}.` : "The ban is permanent."}</p>
      {reason ? <p className="muted">Reason: {reason.slice(0, 500)}</p> : null}
      <p className="muted">You cannot sign in until the ban ends.</p>
    </div>
  );
}
