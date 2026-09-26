import type { BadgeTone } from "@/components/ui/Badge";

export function duration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d`;
}

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const sec = (now - Date.parse(iso)) / 1000;
  if (sec < -5) return `in ${duration(-sec)}`;
  if (sec < 5) return "just now";
  return `${duration(sec)} ago`;
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function clock(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function stamp(iso: string | null | undefined): string {
  return iso ? `${dateTimeFmt.format(new Date(iso))} UTC` : "n/a";
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function matchTone(status: string): BadgeTone {
  switch (status) {
    case "live":
      return "win";
    case "ready":
    case "starting":
      return "info";
    case "accepting":
    case "veto":
    case "allocating":
      return "accent";
    case "finished":
      return "neutral";
    case "abandoned":
      return "warn";
    case "cancelled":
      return "loss";
    default:
      return "neutral";
  }
}

export function hostTone(status: string): BadgeTone {
  if (status === "online") return "win";
  if (status === "updating" || status === "draining") return "warn";
  return "loss";
}

export function trustTone(level: string): BadgeTone {
  if (level === "trusted") return "win";
  if (level === "verified") return "info";
  return "neutral";
}

export function scoreLine(score: Record<string, number> | null): string {
  if (!score) return "";
  return Object.values(score).join(" : ");
}

export const TRUST_LABEL: Record<string, string> = { new: "New", verified: "Verified", trusted: "Trusted" };

// Long durations as hours, one decimal under ten hours
export const hours = (sec: number) => `${(sec / 3600).toFixed(sec >= 36_000 ? 0 : 1)} h`;

export const ACTIVITY_LABEL: Record<string, string> = {
  session_start: "Came online",
  page_view: "Viewed a page",
  queue_join: "Joined the queue",
  queue_leave: "Left the queue",
  queue_matched: "Match found in queue",
  match_found: "Match found",
  match_accept: "Accepted a match",
  match_decline: "Declined a match",
  match_missed: "Missed the accept",
  match_start: "Match started",
  match_end: "Match ended",
  cup_signup: "Signed up for a cup",
  cup_withdraw: "Withdrew from a cup",
  discord_link: "Linked Discord",
  discord_unlink: "Unlinked Discord",
};

const DETAIL_LABEL: Record<string, string> = {
  left: "left",
  joined: "added to the server",
  mode_closed: "mode closed",
  party_changed: "party changed",
  requeue: "put back in queue",
  win: "win",
  loss: "loss",
  forfeit: "forfeit",
  abandoned: "abandoned",
  cancelled: "cancelled",
  queue: "from queue",
  tournament: "cup match",
  challenge: "challenge",
};

// The extra detail worth showing next to an action, or null
export function activityDetail(kind: string | null, detail: string | null): string | null {
  if (!detail) return null;
  if (kind === "queue_matched") return null;
  if (kind === "queue_join" && detail !== "requeue") return detail.split(",").join(", ");
  return DETAIL_LABEL[detail] ?? detail;
}
