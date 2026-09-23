"use client";

import { MODE_COPY } from "@/lib/modes";
import { adminApi } from "../_lib/client";
import { shortId } from "../_lib/format";
import type { MatchSummaryView } from "../_lib/types";
import { ConfirmDialog } from "./parts";

export function CancelMatchDialog({
  match,
  onClose,
  onDone,
}: {
  match: Pick<MatchSummaryView, "id" | "mode" | "status"> | null;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <ConfirmDialog
      open={match !== null}
      title="Cancel match"
      body={
        match && (
          <p>
            Cancels {MODE_COPY[match.mode].label} match <span className="mono">{shortId(match.id)}</span> ({match.status}). No
            rating changes are applied and the server is released. Players are told the match was cancelled.
          </p>
        )
      }
      confirmLabel="Cancel match"
      reason="required"
      danger
      onClose={onClose}
      onConfirm={async (reason) => {
        if (!match) return;
        await adminApi.cancelMatch(match.id, reason);
        onDone();
      }}
    />
  );
}
