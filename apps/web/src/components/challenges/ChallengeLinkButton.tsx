"use client";

import { useId, useState } from "react";
import { isTestMode, MODE_CONFIGS, type CreateChallengeResponse, type Mode } from "@rushsite/shared";
import { Button, ButtonLink, type ButtonProps } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { offeredModes, useServiceStatus } from "@/components/stats/useServiceStatus";
import { api } from "@/lib/api";
import { useMapPool } from "@/lib/mapPool";
import { hasLadderVeto, MODE_COPY, teamSize } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { shareLine } from "./copy";
import { challengeError } from "./useChallenges";
import styles from "./challenges.module.css";

const ANY_MAP = "";

// Makes an open challenge link anyone can accept, with an optional map that skips the veto
export function ChallengeLinkButton({ variant = "secondary", label = "Challenge link" }: { variant?: ButtonProps["variant"]; label?: string }) {
  const { user } = useSession();
  const pool = useMapPool();
  const modes = offeredModes(useServiceStatus()).filter((m) => !isTestMode(m));
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("aim1v1");
  const [mapId, setMapId] = useState(ANY_MAP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<CreateChallengeResponse | null>(null);
  const name = useId();

  if (!user || modes.length === 0) return null;

  const pickable = hasLadderVeto(mode);
  const liveMaps = [...pool.values()].filter((m) => m.modes.includes(mode));
  const maps = liveMaps.length > 0 ? liveMaps : MODE_CONFIGS[mode].maps;

  function pickMode(m: Mode) {
    setMode(m);
    setMapId(ANY_MAP);
    setMade(null);
    setError(null);
  }

  async function makeLink() {
    setBusy(true);
    setError(null);
    try {
      setMade(await api.challenges.create({ mode, ...(pickable && mapId ? { mapId } : {}) }));
    } catch (e) {
      setError(challengeError(e));
    }
    setBusy(false);
  }

  const c = made?.challenge;
  const message = made && c ? shareLine(c.mode, c.map, made.url) : "";

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Challenge link"
        size="md"
        footer={
          made && c ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
              <ButtonLink href={`/challenge/${c.code}`} onClick={() => setOpen(false)}>
                Open challenge page
              </ButtonLink>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={makeLink} loading={busy}>
                Create link
              </Button>
            </>
          )
        }
      >
        <p className="muted">Anyone with the link can accept. They sign in with Steam and land on your challenge. It is unrated and open for 10 minutes.</p>
        <fieldset className={styles.modes}>
          <legend className="visually-hidden">Mode</legend>
          {modes.map((m) => (
            <label key={m} className={styles.mode}>
              <input type="radio" name={name} value={m} checked={mode === m} onChange={() => pickMode(m)} />
              <span>{MODE_COPY[m].label}</span>
              {teamSize(m) > 1 && <span className={styles.modeHint}>Full party of {teamSize(m)}</span>}
            </label>
          ))}
        </fieldset>
        {pickable && (
          <Select
            label="Map"
            value={mapId}
            onChange={(e) => {
              setMapId(e.target.value);
              setMade(null);
            }}
            options={[{ value: ANY_MAP, label: "Any map, ban veto first" }, ...maps.map((m) => ({ value: m.id, label: m.displayName }))]}
          />
        )}
        {made && c && (
          <>
            <label className="visually-hidden" htmlFor={`${name}-link`}>
              Challenge link
            </label>
            <div className={styles.linkRow}>
              <input id={`${name}-link`} className={`${styles.linkInput} mono`} value={made.url} readOnly onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={made.url}>Copy link</CopyButton>
            </div>
            <div className={styles.linkRow}>
              <span className={`${styles.shareLine} mono`}>{message}</span>
              <CopyButton text={message} variant="ghost">
                Copy message
              </CopyButton>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
