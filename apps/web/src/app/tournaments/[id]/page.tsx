import type { Metadata } from "next";
import { TournamentDetailView } from "./TournamentDetailView";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Tournament" };

export default async function TournamentPage({ params }: Props) {
  const { id } = await params;
  return <TournamentDetailView id={id} />;
}
