import type { Metadata } from "next";
import { dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Account banned", robots: { index: false } };

type Props = { searchParams: Promise<{ until?: string; reason?: string; permanent?: string }> };

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@duelrush.site";

// Shown instead of a session when a banned player signs in. React escapes the reason
export default async function BannedPage({ searchParams }: Props) {
  const { until, reason, permanent } = await searchParams;
  const end = until && !Number.isNaN(Date.parse(until)) ? dateTime(until) : null;
  // Only an explicit flag with no end date means permanent. A bare link says nothing more
  const lasting = !until && permanent === "1";
  const title = end ? `Your account is banned until ${end}` : lasting ? "Your account is banned permanently" : "Your account is banned";
  return (
    <div className="container page">
      <h1>{title}</h1>
      {reason ? <p className="muted">Reason: {reason.slice(0, 500)}</p> : null}
      <p className="muted">{end ? "You can sign in again once the ban ends." : lasting ? "You cannot sign in with this account." : "You cannot sign in while the ban is active."}</p>
      <p>
        Think this is a mistake? Email <a href={`mailto:${SUPPORT_EMAIL}?subject=Ban%20appeal`}>{SUPPORT_EMAIL}</a> with your Steam profile link to appeal.
      </p>
    </div>
  );
}
