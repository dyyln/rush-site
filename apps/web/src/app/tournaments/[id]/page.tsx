import type { Metadata } from "next";
import { Suspense } from "react";
import { TournamentDetailView } from "./TournamentDetailView";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Cup" };

export default async function TournamentPage({ params }: Props) {
  const { id } = await params;
  return (
    <Suspense>
      <TournamentDetailView id={id} />
    </Suspense>
  );
}
