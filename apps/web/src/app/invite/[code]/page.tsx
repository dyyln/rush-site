import type { Metadata } from "next";
import { InviteView } from "./InviteView";

export const metadata: Metadata = { title: "Party invite" };

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <InviteView code={code} />;
}
