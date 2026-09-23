// Trust progress helpers. Shapes come from @rushsite/shared schemas/trust.ts
import type { TrustLevel, TrustProgress, TrustRequirement, TrustRequirementKey } from "@rushsite/shared";

export type TrustStatus = TrustProgress;
export type TrustRequirementStatus = TrustRequirement;

export const TRUST_NAMES: Record<TrustLevel, string> = { new: "New", verified: "Verified", trusted: "Trusted" };

// Word for a counted requirement in the progress line
const UNITS: Partial<Record<TrustRequirementKey, string>> = {
  matches: "matches",
  clean_history: "clean matches",
  account_age: "days",
};

// Short line like "New · 2 of 5 matches to Verified"
export function trustProgressLine(t: TrustStatus): string {
  const name = TRUST_NAMES[t.level];
  if (!t.next) return name;
  const next = TRUST_NAMES[t.next];
  const open = t.requirements.filter((r) => !r.met);
  if (open.length === 0) return `${name} · ${next} soon`;
  const counted = open.find((r) => r.progress);
  if (counted?.progress) {
    const unit = UNITS[counted.key];
    return `${name} · ${counted.progress.current} of ${counted.progress.required}${unit ? ` ${unit}` : ""} to ${next}`;
  }
  return `${name} · ${open[0]!.label} to reach ${next}`;
}

export const MOCK_TRUST: TrustStatus = {
  level: "new",
  next: "verified",
  requirements: [
    { key: "steam_check", label: "Steam checks passed", met: true },
    { key: "faceit_check", label: "FACEIT clean or no account", met: true },
    { key: "matches", label: "Completed matches", met: false, progress: { current: 2, required: 5 } },
  ],
};
