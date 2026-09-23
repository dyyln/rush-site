import type { Metadata } from "next";
import { DesignGuide } from "./DesignGuide";

export const metadata: Metadata = { title: "Design system" };

export default function DesignPage() {
  return <DesignGuide />;
}
