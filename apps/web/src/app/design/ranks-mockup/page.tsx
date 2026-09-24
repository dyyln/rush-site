import type { Metadata } from "next";
import { RanksMockup } from "./RanksMockup";

export const metadata: Metadata = { title: "Ranks mockup" };

// Design exploration for rank names, tier colours, splits, emblems and cup badges. Fake data only
export default function RanksMockupPage() {
  return <RanksMockup />;
}
