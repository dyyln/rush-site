import type { Metadata } from "next";
import { TournamentsView } from "./TournamentsView";

export const metadata: Metadata = { title: "Tournaments" };

export default function TournamentsPage() {
  return <TournamentsView />;
}
