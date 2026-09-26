import type { Metadata } from "next";
import { BRAND_NAME } from "@rushsite/shared";
import { challengeDescription, challengeHeadline } from "@/components/challenges/copy";
import { ChallengeView } from "./ChallengeView";
import { challengePreview } from "./preview";

type Props = { params: Promise<{ code: string }> };

// Links get pasted into Discord and Twitter, so the preview names the challenger, mode and map
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const p = await challengePreview(code);
  const title = p ? challengeHeadline(p.createdBy.displayName, p.mode, p.map) : "Challenge";
  const description = p ? challengeDescription(p.mode, p.map, p.status) : `Answer a CS2 challenge on ${BRAND_NAME}.`;
  const path = `/challenge/${encodeURIComponent(code)}`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: BRAND_NAME, title, description, url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ChallengePage({ params }: Props) {
  const { code } = await params;
  return <ChallengeView code={code} />;
}
