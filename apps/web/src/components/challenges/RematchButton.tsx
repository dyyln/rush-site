"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Challenge, Mode } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { challengeError, goToMatch, useChallengeUpdates } from "./useChallenges";
import styles from "./challenges.module.css";

type RematchButtonProps = {
  matchId: string;
  mode: Mode;
  // Every player in the finished match. Others do not see the button. Omit when the viewer is known to have played
  participants?: string[];
  onError?: (message: string) => void;
};

// Asks the other side for a rematch, or accepts theirs when they asked first
export function RematchButton({ matchId, mode, participants, onError }: RematchButtonProps) {
  const { user } = useSession();
  const router = useRouter();
  const me = user?.steamId;
  const inMatch = !!me && (!participants || participants.includes(me));
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inMatch) return;
    let live = true;
    api.challenges.mine().then(
      (list) => live && setChallenge(list.find((c) => c.rematchOfMatchId === matchId) ?? null),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [inMatch, matchId]);

  useChallengeUpdates((c) => {
    if (c.rematchOfMatchId !== matchId) return;
    setChallenge(c.status === "open" || c.status === "accepted" ? c : null);
    if (c.status === "accepted") goToMatch(router.push);
  }, inMatch);

  if (!inMatch) return null;

  const fail = (e: unknown) => {
    const msg = challengeError(e);
    setError(msg);
    onError?.(msg);
    setBusy(false);
  };

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const { challenge: c } = await api.challenges.create({ mode, rematchOfMatchId: matchId });
      setChallenge(c);
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  }

  async function accept(c: Challenge) {
    setBusy(true);
    setError(null);
    try {
      await api.challenges.accept(c.code);
      goToMatch(router.push);
    } catch (e) {
      fail(e);
    }
  }

  const theirs = challenge && challenge.status === "open" && challenge.createdBy.steamId !== me;
  const mine = challenge && challenge.status === "open" && challenge.createdBy.steamId === me;

  return (
    <span className={styles.inline}>
      {theirs ? (
        <Button onClick={() => accept(challenge)} loading={busy}>
          Accept rematch
        </Button>
      ) : mine ? (
        <Link href={`/challenge/${challenge.code}`} className="muted">
          Rematch sent, waiting
        </Link>
      ) : challenge?.status === "accepted" ? (
        <span className="muted">Rematch starting</span>
      ) : (
        <Button variant="secondary" onClick={ask} loading={busy}>
          Rematch
        </Button>
      )}
      {error && !onError && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </span>
  );
}
