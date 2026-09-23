import type { ModeUnavailableReason } from "@rushsite/shared";

export const UNAVAILABLE_COPY: Record<ModeUnavailableReason, string> = {
  not_configured: "Not configured",
  no_servers: "No servers online",
  servers_updating: "Updating",
  closed: "Closed",
};

export function unavailableText(reason?: ModeUnavailableReason): string {
  return reason ? UNAVAILABLE_COPY[reason] : "Unavailable";
}
