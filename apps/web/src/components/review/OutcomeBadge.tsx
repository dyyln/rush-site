import type { ReportOutcome } from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import { OUTCOME } from "./copy";

export function OutcomeBadge({ outcome }: { outcome: ReportOutcome }) {
  const o = OUTCOME[outcome];
  return (
    <span title={o.detail}>
      <Badge tone={o.tone}>{o.label}</Badge>
    </span>
  );
}
