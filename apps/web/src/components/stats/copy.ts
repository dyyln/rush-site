import type { ModeUnavailableReason } from "@rushsite/shared";

export const UNAVAILABLE_COPY: Record<ModeUnavailableReason, string> = {
  not_configured: "Not open yet",
  no_servers: "No servers online",
  servers_updating: "Servers updating",
  closed: "Closed for now",
  disabled: "Switched off",
};

export function unavailableText(reason?: ModeUnavailableReason): string {
  return reason ? UNAVAILABLE_COPY[reason] : "Not available";
}
