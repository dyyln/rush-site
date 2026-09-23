import { redirect } from "next/navigation";
import { safeReturnTo, steamLoginUrl } from "@/lib/api";
import { isMock } from "@/lib/env";
import { MockLogin } from "./MockLogin";

type Props = { searchParams: Promise<{ returnTo?: string }> };

// Kept for old links. Sends the browser straight to Steam sign in on the api
export default async function LoginPage({ searchParams }: Props) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (isMock) return <MockLogin returnTo={returnTo} />;
  redirect(steamLoginUrl(returnTo));
}
