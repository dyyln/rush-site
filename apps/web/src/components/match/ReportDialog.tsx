"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TeamMarker } from "@/components/ui/TeamMarker";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";
import type { ReportReason } from "@/lib/types";
import { FlagIcon } from "./icons";
import type { Roster } from "./roster";
import styles from "./ReportDialog.module.css";

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "aimbot", label: "Aimbot", hint: "Inhuman aim, snapping or tracking" },
  { value: "wallhack", label: "Wallhack", hint: "Knows where players are through walls" },
  { value: "griefing", label: "Griefing", hint: "Throwing, team damage or abuse" },
  { value: "other", label: "Other", hint: "Anything else. A note helps" },
];

const NOTE_MAX = 500;

const REPORT_ERRORS: Record<string, string> = {
  match_not_started: "Reports open once the match has started.",
  not_a_participant: "Only players in this match can report.",
  cannot_report_self: "You cannot report yourself.",
  player_not_in_match: "That player is not in this match.",
  unauthorized: "Sign in to report a player.",
};

// Remembers who this browser already reported so the state survives a reload
function storageKey(matchId: string) {
  return `rushsite.reports.${matchId}`;
}

function loadReported(matchId: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(matchId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveReported(matchId: string, ids: string[]) {
  try {
    window.localStorage.setItem(storageKey(matchId), JSON.stringify(ids));
  } catch {
    // Storage can be blocked. The api still rejects duplicates
  }
}

type ReportButtonProps = { matchId: string; roster: Roster; viewer: string; serverReported?: string[] };

export function ReportButton({ matchId, roster, viewer, serverReported }: ReportButtonProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Reports sent from this page. The api list is the source of truth and localStorage is only a fallback
  const [sent, setSent] = useState<string[]>([]);
  const [stored, setStored] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const noteId = useId();

  useEffect(() => setStored(loadReported(matchId)), [matchId]);
  const reported = [...new Set([...(serverReported ?? stored), ...sent])];

  const players = [...roster.values()].filter((e) => e.player.steamId !== viewer);
  const remaining = players.filter((e) => !reported.includes(e.player.steamId));
  if (players.length === 0) return null;
  const allDone = remaining.length === 0;

  const start = () => {
    setTarget(remaining.length === 1 ? remaining[0]!.player.steamId : null);
    setReason(null);
    setNote("");
    setError(null);
    setOpen(true);
  };

  const markReported = (steamId: string) => {
    setSent((list) => [...new Set([...list, steamId])]);
    saveReported(matchId, [...new Set([...stored, steamId])]);
  };

  const submit = async () => {
    if (!target) return setError("Pick a player to report.");
    if (!reason) return setError("Pick a reason.");
    setBusy(true);
    setError(null);
    const name = roster.get(target)?.player.displayName ?? "Player";
    try {
      await api.reportPlayer(matchId, { steamId: target, reason, note: note.trim() || undefined });
      markReported(target);
      setOpen(false);
      toast.push({ title: `${name} reported`, body: "Thanks. Reports feed our review queue.", tone: "success" });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "already_reported") {
        markReported(target);
        setOpen(false);
        toast.push({ title: `You already reported ${name} in this match`, tone: "info" });
      } else {
        setError(REPORT_ERRORS[code] ?? (e instanceof ApiError && e.status === 401 ? REPORT_ERRORS.unauthorized! : "Could not send the report. Try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" icon={<FlagIcon />} onClick={start} disabled={allDone}>
        {allDone ? "Reported" : "Report"}
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Report a player"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" form={formId} loading={busy}>
              Send report
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Player</legend>
            {players.map(({ player: p, side }) => {
              const done = reported.includes(p.steamId);
              return (
                <label key={p.steamId} className={styles.option} data-disabled={done || undefined}>
                  <input
                    type="radio"
                    name="target"
                    value={p.steamId}
                    checked={target === p.steamId}
                    disabled={done}
                    onChange={() => setTarget(p.steamId)}
                  />
                  <span className={styles.optionMain}>
                    <TeamMarker side={side} />
                    <span className={styles.optionName}>{p.displayName}</span>
                  </span>
                  {done && <span className={styles.optionHint}>Reported</span>}
                </label>
              );
            })}
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.legend}>Reason</legend>
            <div className={styles.reasons}>
              {REASONS.map((r) => (
                <label key={r.value} className={styles.option}>
                  <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                  <span className={styles.optionText}>
                    <span className={styles.optionName}>{r.label}</span>
                    <span className={styles.optionHint}>{r.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className={styles.group}>
            <label htmlFor={noteId} className={styles.legend}>
              Note <span className="muted">(optional)</span>
            </label>
            <textarea
              id={noteId}
              className={styles.note}
              rows={3}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Round numbers or what you saw help reviewers"
            />
            <p className={styles.count} aria-live="polite">
              {note.length}/{NOTE_MAX}
            </p>
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <p className={styles.fine}>False reports count against your trust level. One report per player per match.</p>
        </form>
      </Modal>
    </>
  );
}
