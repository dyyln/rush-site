import type { BadgeTone } from "@/components/ui/Badge";
import type { TournamentStatus, TournamentSummary } from "./types";

export const STATUS_LABEL: Record<TournamentStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Sign ups open", tone: "accent" },
  running: { label: "Live", tone: "win" },
  completed: { label: "Finished", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "loss" },
};

export function formatLabel(t: TournamentSummary): string {
  const { default: d, semis, final } = t.format.bestOf;
  if (d === semis && semis === final) return `Single elimination, Bo${d}`;
  if (d === semis) return `Single elimination, Bo${d}, Bo${final} final`;
  return `Single elimination, Bo${d}, Bo${semis} semis, Bo${final} final`;
}
