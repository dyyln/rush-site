"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PartyUpdatePayload } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SignInLink } from "@/components/ui/SignInLink";
import { Card } from "@/components/ui/Card";
import { ApiError, api, type InvitePreview } from "@/lib/api";
import { useSession } from "@/lib/session";

type Problem = { title: string; body: string };

const INVALID: Problem = {
  title: "This invite link no longer works",
  body: "The link is wrong or has expired. The leader may have made a new link or closed the party. Ask them for a fresh one.",
};
const FULL: Problem = { title: "This party is full", body: "Ask the leader to make room, or start your own party." };

function problemFor(e: unknown): Problem {
  if (e instanceof ApiError) {
    if (e.status === 404 || e.status === 410 || e.code === "invite_not_found" || e.code === "invite_expired") return INVALID;
    if (e.code === "party_full") return FULL;
    if (e.code === "party_locked") return { title: "Party is in a match", body: "You can join after the match ends." };
    if (e.code === "party_changed") return { title: "Your party changed while joining", body: "Try again." };
    if (e.status === 401) return { title: "Sign in to join", body: "Your session ended. Sign in again." };
  }
  return { title: "Could not join the party", body: "Something went wrong. Try again in a moment." };
}

export function InviteView({ code }: { code: string }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [current, setCurrent] = useState<PartyUpdatePayload | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (loading) return;
    let live = true;
    setChecking(true);
    Promise.all([api.party.preview(code), user ? api.party.get().catch(() => null) : Promise.resolve(null)])
      .then(([p, mine]) => {
        if (!live) return;
        setPreview(p);
        setCurrent(mine);
        setProblem(p.full && !p.isMember ? FULL : null);
      })
      .catch((e) => live && setProblem(problemFor(e)))
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [code, user, loading]);

  async function join() {
    setBusy(true);
    setProblem(null);
    try {
      await api.party.join(code);
      router.push("/play");
    } catch (e) {
      setProblem(problemFor(e));
      setBusy(false);
    }
  }

  const member = preview?.isMember ?? false;
  const leavesParty = !!current?.partyId && current.partyId !== preview?.partyId && current.members.length > 1;

  return (
    <div className="container page">
      <header className="page-header">
        <h1>Party invite</h1>
      </header>
      <Card tone="raised">
        <div className="stack">
          {preview && !problem && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <Avatar name={preview.leader.displayName} src={preview.leader.avatarUrl} size="lg" />
              <div>
                <p>
                  <strong>{preview.leader.displayName}</strong> invited you to their party
                </p>
                <p className="muted">
                  {preview.size} of {preview.capacity} players
                </p>
              </div>
            </div>
          )}
          {problem && (
            <div role="alert">
              <p style={{ color: "var(--color-loss)", fontWeight: 600 }}>{problem.title}</p>
              <p className="muted">{problem.body}</p>
            </div>
          )}
          {leavesParty && !problem && !member && (
            <p className="muted">Joining takes you out of your current party and cancels its queue.</p>
          )}
          {loading || checking ? null : member ? (
            <>
              <p className="muted">You are already in this party.</p>
              <ButtonLink href="/play" size="lg">
                Go to Play
              </ButtonLink>
            </>
          ) : problem === INVALID ? (
            <ButtonLink href="/play" variant="secondary" size="lg">
              Go to Play
            </ButtonLink>
          ) : problem === FULL ? (
            <ButtonLink href="/play" variant="secondary" size="lg">
              Start your own party
            </ButtonLink>
          ) : user ? (
            <Button size="lg" onClick={join} loading={busy}>
              Join party
            </Button>
          ) : (
            <SignInLink size="lg">Sign in to join</SignInLink>
          )}
        </div>
      </Card>
    </div>
  );
}
