import { isMatchSlug } from "@rushsite/shared";
import type { Metadata } from "next";
import { MatchView } from "./MatchView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const card = `/matches/${id}/card`;
  return {
    title: isMatchSlug(id) ? `Match ${id}` : "Match",
    openGraph: { images: [{ url: card, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", images: [card] },
  };
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatchView id={id} />;
}
