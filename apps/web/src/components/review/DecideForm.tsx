"use client";

import type { ReviewDecideBody, ReviewDecideResponse, ReviewFlag } from "@rushsite/shared";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ApiError } from "@/lib/api";
import { reviewApi } from "./api";
import styles from "./review.module.css";

type Outcome = ReviewDecideBody["outcome"];
type BanLength = "none" | "7" | "30" | "permanent";

const BAN_OPTIONS: { value: BanLength; label: string }[] = [
  { value: "permanent", label: "Permanent" },
  { value: "30", label: "30 days" },
  { value: "7", label: "7 days" },
  { value: "none", label: "No ban" },
];

const NOTE_MAX = 1000;

function message(e: unknown): string {
  if (e instanceof ApiError) return e.message || e.code;
  return e instanceof Error ? e.message : String(e);
}

// Claim and decide. Confirmed rolls back rating whatever the ban choice
export function DecideForm({
  flag,
  viewer,
  onChange,
}: {
  flag: ReviewFlag;
  viewer: string | undefined;
  onChange: (flag: ReviewFlag, result?: ReviewDecideResponse) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>("cleared");
  const [note, setNote] = useState("");
  const [ban, setBan] = useState<BanLength>("permanent");
  const [reason, setReason] = useState("Cheating confirmed by review");
  const [busy, setBusy] = useState<"claim" | "decide" | null>(null);
  const [error, setError] = useState<string>();
  const noteId = useId();

  const decided = flag.status === "cleared" || flag.status === "confirmed";
  const ownCase = flag.player.steamId === viewer;
  const claimedByOther = flag.status === "reviewing" && flag.reviewer && flag.reviewer.steamId !== viewer;

  if (decided) {
    return (
      <div className={styles.decided}>
        <p>
          {flag.status === "confirmed" ? "Confirmed" : "Cleared"} by {flag.reviewer?.displayName ?? "an admin"}.
        </p>
        {flag.note && <p className={styles.noteText}>{flag.note}</p>}
      </div>
    );
  }
  if (ownCase) return <p className="muted">This case is about you. Another admin has to review it.</p>;
  if (claimedByOther) return <p className="muted">{flag.reviewer?.displayName} is reviewing this case.</p>;

  async function claim() {
    setBusy("claim");
    setError(undefined);
    try {
      onChange(await reviewApi.claim(flag.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function decide() {
    setBusy("decide");
    setError(undefined);
    const body: ReviewDecideBody = { outcome, note: note.trim() };
    if (outcome === "confirmed" && ban !== "none") {
      body.ban = {
        reason: reason.trim(),
        until: ban === "permanent" ? null : new Date(Date.now() + Number(ban) * 86_400_000).toISOString(),
      };
    }
    try {
      const res = await reviewApi.decide(flag.id, body);
      onChange(res.flag, res);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const blocked = note.trim().length === 0 || (outcome === "confirmed" && ban !== "none" && reason.trim().length === 0);

  return (
    <div className="stack">
      {flag.status === "open" && (
        <div className="row">
          <Button variant="secondary" onClick={claim} loading={busy === "claim"} disabled={busy !== null}>
            Claim case
          </Button>
          <span className="muted">Claiming tells other reviewers you have it and moves reports to under review.</span>
        </div>
      )}
      <SegmentedControl
        label="Verdict"
        value={outcome}
        onChange={setOutcome}
        options={[
          { value: "cleared", label: "Clean" },
          { value: "confirmed", label: "Cheating" },
        ]}
      />
      {outcome === "confirmed" && (
        <div className={styles.banBox}>
          <SegmentedControl label="Ban" value={ban} onChange={setBan} options={BAN_OPTIONS} />
          {ban !== "none" && <Input label="Ban reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
          <p className="muted">Wins in the rollback window are voided and opponents get their rating back.</p>
        </div>
      )}
      <div className={styles.field}>
        <label htmlFor={noteId} className={styles.label}>
          Note
        </label>
        <textarea
          id={noteId}
          className={styles.textarea}
          value={note}
          maxLength={NOTE_MAX}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What you saw. Saved with the verdict as a training label"
        />
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className="row">
        <Button
          variant={outcome === "confirmed" ? "danger" : "primary"}
          onClick={decide}
          loading={busy === "decide"}
          disabled={blocked || busy !== null}
        >
          {outcome === "confirmed" ? (ban === "none" ? "Confirm and roll back" : "Confirm and ban") : "Clear player"}
        </Button>
      </div>
    </div>
  );
}
