"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AIM_MAPS, type Challenge, type ChallengeStatus } from "@rushsite/shared";
import { challengeClosedLine, challengeRules, shareLine } from "@/components/challenges/copy";
import { challengeError, goToMatch, useChallengeUpdates } from "@/components/challenges/useChallenges";
import shared from "@/components/challenges/challenges.module.css";
import { DockButton, DockCountdown, DockLink, DockTimer } from "@/components/layout/Dock";
import { useDockAction, type DockAction } from "@/components/layout/dockStore";
import { BannerChip, BannerPerson, BannerSeat, BannerVs, InviteBanner } from "@/components/party/InviteBanner";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Card } from "@/components/ui/Card";
import { SignInLink } from "@/components/ui/SignInLink";
import { ApiError, api, steamLoginUrl } from "@/lib/api";
import { hasLadderVeto, MODE_ART, MODE_COPY, teamSize } from "@/lib/modes";
import { useSession } from "@/lib/session";
import styles from "./challenge.module.css";

const STATUS: Record<ChallengeStatus, { label: string; tone?: "accent" | "win" | "loss" }> = {
  open: { label: "Open", tone: "accent" },
  accepted: { label: "Accepted", tone: "win" },
  declined: { label: "Declined", tone: "loss" },
  expired: { label: "Expired" },
  cancelled: { label: "Withdrawn" },
};

const LOCAL_ART = new Set(AIM_MAPS.map((m) => m.id));

// The chosen map's art when there is one, else the mode's
function artFor(c: Challenge): string {
  return c.map && LOCAL_ART.has(c.map.id) ? `/maps/${c.map.id}.webp` : MODE_ART[c.mode];
}

const toPlay = (
  <DockLink href="/play" tone="quiet">
    Go to Play
  </DockLink>
);

// A challenge link. The banner shows who plays whom, the dock holds Accept or the wait
export function ChallengeView({ code }: { code: string }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
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

  async function act(which: "accept" | "decline") {
    if (!challenge) return;
    setBusy(which);
    setError(null);
    try {
      const next = which === "accept" ? await api.challenges.accept(challenge.code) : await api.challenges.decline(challenge.code);
      setChallenge(next);
      setBusy(null);
      if (next.status === "accepted") goToMatch(router.push);
    } catch (e) {
      setError(challengeError(e));
      setBusy(null);
    }
  }

  const c = challenge;
  const me = user?.steamId;
  const isCreator = !!c && me === c.createdBy.steamId;
  const canAnswer = !!c && !!me && !isCreator && (!c.target || c.target.steamId === me);
  const open = c?.status === "open";
  const kind = c?.rematchOfMatchId ? "Rematch" : "Challenge";
  const expires = c ? Date.parse(c.expiresAt) : 0;

  useDockAction(dockFor());

  function dockFor(): DockAction {
    if (loadError) return { label: "Challenge", value: loadError === "not_found" ? "Not found" : "Could not load", action: toPlay };
    if (!c) return { label: "Challenge", value: "Loading", action: null };
    const left = (
      <>
        <DockCountdown until={expires} /> left
      </>
    );
    if (c.status === "accepted") {
      return {
        label: `${kind} accepted`,
        value: "Match starting",
        action: c.matchId ? (
          <DockLink href={`/matches/${c.matchId}`} tone="win">
            Open match
          </DockLink>
        ) : null,
      };
    }
    if (!open) return { label: `${kind} ${STATUS[c.status].label.toLowerCase()}`, value: MODE_COPY[c.mode].label, action: toPlay };
    if (loading) return { label: kind, value: left, action: null };
    if (!user) {
      return {
        label: `${kind} · ${MODE_COPY[c.mode].format}`,
        value: left,
        action: (
          <DockLink href={steamLoginUrl(pathname)} external>
            Sign in to answer
          </DockLink>
        ),
      };
    }
    if (isCreator) {
      return {
        label: "Waiting for opponent",
        value: c.target ? c.target.displayName : "Anyone with the link",
        action: <DockTimer until={expires} label="to accept" />,
      };
    }
    if (canAnswer) {
      return {
        label: `${kind} · ${MODE_COPY[c.mode].format}`,
        value: left,
        action: (
          <DockButton onClick={() => act("accept")} disabled={busy !== null}>
            {busy === "accept" ? (
              "Accepting"
            ) : (
              <span>
                Accept<span className={styles.wide}> {kind.toLowerCase()}</span>
              </span>
            )}
          </DockButton>
        ),
      };
    }
    return { label: kind, value: `For ${c.target?.displayName ?? "someone else"}`, action: toPlay };
  }

  if (loadError || !c) {
    return (
      <div className={`container ${styles.page}`} aria-busy={!loadError}>
        <InviteBanner
          art={MODE_ART.rush3v3}
          kicker="Challenge"
          title={loadError === "not_found" ? "Challenge not found" : loadError ? "Could not load" : "Challenge"}
        />
        {loadError && (
          <Card>
            <p className="muted">{loadError === "not_found" ? "The link is wrong or the challenge was removed." : "Try again in a moment."}</p>
          </Card>
        )}
      </div>
    );
  }

  const size = teamSize(c.mode);
  const targetIsMe = c.target?.steamId === me;
  const involved = isCreator || targetIsMe;
  const title = !open
    ? `${kind} ${STATUS[c.status].label.toLowerCase()}`
    : isCreator
      ? c.target
        ? `${kind} sent`
        : "Open challenge"
      : `${c.createdBy.displayName} challenges you`;

  return (
    <div className={`container ${styles.page}`}>
      <InviteBanner
        art={artFor(c)}
        kicker={kind}
        title={title}
        chips={
          <>
            <BannerChip tone={STATUS[c.status].tone}>{STATUS[c.status].label}</BannerChip>
            <BannerChip>{MODE_COPY[c.mode].label}</BannerChip>
            {c.map ? <BannerChip>{c.map.displayName}</BannerChip> : hasLadderVeto(c.mode) && <BannerChip>Map veto</BannerChip>}
            <BannerChip>{size > 1 ? `Parties of ${size}` : "Solo"}</BannerChip>
            <BannerChip>Unrated</BannerChip>
          </>
        }
      >
        <BannerPerson person={c.createdBy} role={c.createdBy.steamId === me ? "You" : "Challenger"} />
        <BannerVs />
        {c.target ? <BannerPerson person={c.target} role={targetIsMe ? "You" : "Opponent"} /> : <BannerSeat label="Anyone with the link" role="Open seat" />}
      </InviteBanner>

      <Card className={styles.body}>
        {open && <p className="muted">{challengeRules(c.mode, c.map)} The challenge is open for 10 minutes.</p>}

        {open && !loading && !user && (
          <>
            <p>Sign in with Steam to accept. You come straight back here.</p>
            <div className={shared.actions}>
              <SignInLink>Sign in with Steam to accept</SignInLink>
            </div>
          </>
        )}

        {c.status !== "open" && !involved && (
          <p>
            {challengeClosedLine(c.status)} <Link href="/play">Queue on Play</Link> for a match instead.
          </p>
        )}

        {size > 1 && open && (
          <p className="muted">
            {MODE_COPY[c.mode].format} is played by whole parties. Each side needs a party of {size}, and the party leader answers.
            {c.rematchOfMatchId ? " A rematch needs the same players as the original match." : ""}
          </p>
        )}

        {c.status === "accepted" && c.matchId && involved && (
          <p>
            Match starting. <Link href={`/matches/${c.matchId}`}>Open the match room</Link> for the veto and connect info.
          </p>
        )}

        {c.rematchOfMatchId && (
          <p className="muted">
            Rematch of <Link href={`/matches/${c.rematchOfMatchId}`}>this match</Link>.
          </p>
        )}

        {error && (
          <p role="alert" className={shared.error}>
            {error}
          </p>
        )}

        {open && isCreator && (
          <>
            <p className="muted" aria-live="polite">
              Waiting for {c.target ? c.target.displayName : "someone to accept"}. Keep this page open, it moves on to the {c.map ? "match" : "veto"} when they accept.
            </p>
            <label className="visually-hidden" htmlFor="challenge-link">
              Challenge link
            </label>
            <div className={shared.linkRow}>
              <input id="challenge-link" className={`${shared.linkInput} mono`} value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={url}>Copy link</CopyButton>
            </div>
            {!c.target && url && (
              <div className={shared.linkRow}>
                <span className={`${shared.shareLine} mono`}>{shareLine(c.mode, c.map, url)}</span>
                <CopyButton text={shareLine(c.mode, c.map, url)} variant="ghost">
                  Copy message
                </CopyButton>
              </div>
            )}
          </>
        )}

        {open && (isCreator || (canAnswer && c.target)) && (
          <div className={shared.actions}>
            <Button variant="ghost" onClick={() => act("decline")} loading={busy === "decline"} disabled={busy !== null}>
              {isCreator ? "Withdraw" : "Decline"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
