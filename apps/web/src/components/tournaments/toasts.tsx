import Link from "next/link";
import type { ToastInput } from "@/components/ui/Toast";

export function registeredToast(cup: { id: string; name: string }): ToastInput {
  return {
    title: "You're in",
    tone: "success",
    durationMs: 8000,
    body: (
      <>
        Registered for {cup.name}. <Link href={`/tournaments/${cup.id}`}>View cup page</Link>
      </>
    ),
  };
}
