import type { Metadata } from "next";
import { RanksView } from "./RanksView";

export const metadata: Metadata = { title: "Ranks" };

export default function RanksPage() {
  return <RanksView />;
}
