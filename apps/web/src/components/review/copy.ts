import type { BadgeTone } from "@/components/ui/Badge";
import type { FlagStatus, ReportOutcome, ReportReason } from "@rushsite/shared";

export const OUTCOME: Record<ReportOutcome, { label: string; tone: BadgeTone; detail: string }> = {
  received: { label: "Received", tone: "neutral", detail: "Your report is logged with the match." },
  reviewed: { label: "Under review", tone: "info", detail: "A reviewer is looking at this case." },
  actioned: { label: "Action taken", tone: "win", detail: "A reviewer upheld the report and took action. Thank you." },
  dismissed: { label: "No action", tone: "neutral", detail: "A reviewer checked the match and found no cheating." },
};

export const FLAG_STATUS: Record<FlagStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "warn" },
  reviewing: { label: "Reviewing", tone: "info" },
  cleared: { label: "Cleared", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "loss" },
};

export const REASON: Record<ReportReason, string> = {
  aimbot: "Aimbot",
  wallhack: "Wallhack",
  griefing: "Griefing",
  other: "Other",
};
