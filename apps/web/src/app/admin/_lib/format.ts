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
