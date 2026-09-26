import { cache } from "react";
import type { ChallengePreview } from "@rushsite/shared";
import { apiUrl, isMock } from "@/lib/env";

// Server side read for the page metadata and the link image. null when unknown or the api is down
export const challengePreview = cache(async (code: string): Promise<ChallengePreview | null> => {
  if (isMock || !/^[A-Za-z0-9]{4,16}$/.test(code)) return null;
  try {
    const res = await fetch(`${apiUrl}/challenges/${encodeURIComponent(code)}/preview`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { preview: ChallengePreview }).preview;
  } catch {
    return null;
  }
});
