import type { Metadata } from "next";
import { ChallengeView } from "./ChallengeView";

export const metadata: Metadata = { title: "Challenge" };

export default async function ChallengePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ChallengeView code={code} />;
}
