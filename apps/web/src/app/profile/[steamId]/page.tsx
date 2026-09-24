import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileView } from "./ProfileView";

type Props = { params: Promise<{ steamId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { steamId } = await params;
  return { title: `Player ${steamId}` };
}

export default async function ProfilePage({ params }: Props) {
  const { steamId } = await params;
  return (
    <Suspense>
      <ProfileView steamId={steamId} />
    </Suspense>
  );
}
