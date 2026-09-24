import type { Metadata } from "next";
import { PlayMockup } from "./PlayMockup";

export const metadata: Metadata = { title: "Play mockup" };

// Static mockup of a CS2 style Play screen. Fake data, nothing is wired to the queue
export default function PlayMockupPage() {
  return <PlayMockup />;
}
