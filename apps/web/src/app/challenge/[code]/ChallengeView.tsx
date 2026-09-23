"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CHALLENGE_TTL_SEC, type Challenge, type ChallengePlayer, type ChallengeStatus } from "@rushsite/shared";
import { challengeError, goToMatch, useChallengeUpdates } from "@/components/challenges/useChallenges";
import styles from "@/components/challenges/challenges.module.css";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Card } from "@/components/ui/Card";
import { SignInLink } from "@/components/ui/SignInLink";
import { Timer } from "@/components/ui/Timer";
import { ApiError, api } from "@/lib/api";
import { MODE_COPY, teamSize } from "@/lib/modes";
import { useSession } from "@/lib/session";

const STATUS: Record<ChallengeStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "accent" },
  accepted: { label: "Accepted", tone: "win" },
  declined: { label: "Declined", tone: "loss" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

export function ChallengeView({ code }: { code: string }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loadError, setLoadError] = useState<"not_found" | "failed" | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => setUrl(`${window.location.origin}/challenge/${code}`), [code]);

  useEffect(() => {
    let live = true;
    api.challenges.get(code).then(
      (c) => live && setChallenge(c),
      (e: unknown) => live && setLoadError(e instanceof ApiError && e.status === 404 ? "not_found" : "failed"),
    );
    return () => {
      live = false;
    };
  }, [code]);

  // The creator waits here. The accept moves everyone involved on to the match
  useChallengeUpdates((c) => {
    if (c.code.toUpperCase() !== code.toUpperCase()) return;
    setChallenge(c);
    if (c.status === "accepted") goToMatch(router.push);
  }, !!user);

  if (loadError) {
    return (
      <div className="container page">
        <header className="page-header">
          <h1>{loadError === "not_found" ? "Challenge not found" : "Could not load the challenge"}</h1>
        </header>
        <Card tone="raised">
          <p className="muted">{loadError === "not_found" ? "The link is wrong or the challenge was removed." : "Try again in a moment."}</p>
          <div className={styles.actions}>
            <ButtonLink href="/play" variant="secondary">
              Go to Play
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="container page" aria-busy="true">
        <header className="page-header">
          <h1>Challenge</h1>
        </header>
        <p className="muted">Loading challenge</p>
      </div>
    );
  }

  const c = challenge;
  const me = user?.steamId;
  const isCreator = me === c.createdBy.steamId;
  const canAnswer = !!me && !isCreator && (!c.target || c.target.steamId === me);
  const size = teamSize(c.mode);
  const open = c.status === "open";
  const kind = c.rematchOfMatchId ? "Rematch" : "Challenge";

  async function act(which: "accept" | "decline") {
    setBusy(which);
    setError(null);
    try {
      const next = which === "accept" ? await api.challenges.accept(c.code) : await api.challenges.decline(c.code);
      setChallenge(next);
      setBusy(null);
      if (next.status === "accepted") goToMatch(router.push);
    } catch (e) {
      setError(challengeError(e));
      setBusy(null);
    }
  }

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{kind}</p>
          <h1>
            {c.createdBy.displayName} {c.target ? `challenges ${c.target.steamId === me ? "you" : c.target.displayName}` : "is looking for an opponent"}
          </h1>
        </div>
      </header>

      <Card tone={open ? "accent" : "raised"}>
        <div className="stack">
          <div className={styles.meta}>
            <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
            <span className="eyebrow">{MODE_COPY[c.mode].label}</span>
            <Badge tone="info">Unrated</Badge>
            <span className="muted">
              {MODE_COPY[c.mode].players}, {MODE_COPY[c.mode].blurb}
            </span>
          </div>

          <div className={styles.versus}>
            <PlayerChip p={c.createdBy} />
            <span className={styles.vs} aria-hidden="true">
              vs
            </span>
            {c.target ? <PlayerChip p={c.target} /> : <span className="muted">Anyone with the link</span>}
          </div>

          {open && (
            <Timer until={Date.parse(c.expiresAt)} totalSec={CHALLENGE_TTL_SEC} label="Time left to accept" />
          )}

          {size > 1 && open && (
            <p className="muted">
              {MODE_COPY[c.mode].format} is played by whole parties. Each side needs a party of {size}, and the party leader answers.
              {c.rematchOfMatchId ? " A rematch needs the same players as the original match." : ""}
            </p>
          )}

          {c.status === "accepted" && c.matchId && (
            <p>
              Match starting. <a href="/play">Go to Play</a> for the veto, or <Link href={`/matches/${c.matchId}`}>open the match page</Link>.
            </p>
          )}

          {c.rematchOfMatchId && (
            <p className="muted">
              Rematch of <Link href={`/matches/${c.rematchOfMatchId}`}>this match</Link>.
            </p>
          )}

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          {open && !loading && !user && <SignInLink size="lg">Sign in to answer</SignInLink>}

          {open && canAnswer && (
            <div className={styles.actions}>
              <Button size="lg" onClick={() => act("accept")} loading={busy === "accept"} disabled={busy !== null}>
                Accept
              </Button>
              {c.target && (
                <Button size="lg" variant="ghost" onClick={() => act("decline")} loading={busy === "decline"} disabled={busy !== null}>
                  Decline
                </Button>
              )}
            </div>
          )}

          {open && isCreator && (
            <>
              <p className="muted" aria-live="polite">
                Waiting for {c.target ? c.target.displayName : "someone to accept"}. Keep this page open, it moves on to the veto when they accept.
              </p>
              <label className="visually-hidden" htmlFor="challenge-link">
                Challenge link
              </label>
              <div className={styles.linkRow}>
                <input id="challenge-link" className={`${styles.linkInput} mono`} value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
                <CopyButton text={url}>Copy link</CopyButton>
              </div>
              <div className={styles.actions}>
                <Button variant="ghost" onClick={() => act("decline")} loading={busy === "decline"}>
                  Withdraw
                </Button>
              </div>
            </>
          )}

          {!open && c.status !== "accepted" && (
            <div className={styles.actions}>
              <ButtonLink href="/play" variant="secondary">
                Go to Play
              </ButtonLink>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function PlayerChip({ p }: { p: ChallengePlayer }) {
  return (
    <Link href={`/profile/${p.steamId}`} className={styles.player}>
      <Avatar name={p.displayName} src={p.avatarUrl} />
      <span className={styles.playerName}>{p.displayName}</span>
    </Link>
  );
}
