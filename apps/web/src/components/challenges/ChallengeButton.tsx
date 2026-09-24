"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { isTestMode, type Mode } from "@rushsite/shared";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { MODE_COPY, teamSize } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { offeredModes, useServiceStatus } from "@/components/stats/useServiceStatus";
import { challengeError } from "./useChallenges";
import styles from "./challenges.module.css";

type ChallengeButtonProps = {
  target: { steamId: string; displayName: string };
  defaultMode?: Mode;
  variant?: ButtonProps["variant"];
  label?: string;
};

// Opens a mode picker and sends a direct challenge. Hidden when signed out or on your own profile
export function ChallengeButton({ target, defaultMode = "aim1v1", variant = "secondary", label = "Challenge" }: ChallengeButtonProps) {
  const { user } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const modes = offeredModes(useServiceStatus());
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useId();

  if (!user || user.steamId === target.steamId) return null;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const { challenge } = await api.challenges.create({ mode, targetSteamId: target.steamId });
      router.push(`/challenge/${challenge.code}`);
    } catch (e) {
      setError(challengeError(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Challenge ${target.displayName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send} loading={busy}>
              Send challenge
            </Button>
          </>
        }
      >
        <fieldset className={styles.modes}>
          <legend className="visually-hidden">Mode</legend>
          {modes.map((m) => (
            <label key={m} className={styles.mode}>
              <input type="radio" name={name} value={m} checked={mode === m} onChange={() => setMode(m)} />
              <span>{MODE_COPY[m].label}</span>
              {isTestMode(m) && <span className={styles.modeHint}>Test, unrated</span>}
              {teamSize(m) > 1 && <span className={styles.modeHint}>Full party of {teamSize(m)}</span>}
            </label>
          ))}
        </fieldset>
        <p className="muted">The challenge is open for 10 minutes. No queue and no accept step, the veto starts when they accept.</p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
