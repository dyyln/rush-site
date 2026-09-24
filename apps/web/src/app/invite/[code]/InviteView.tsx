"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PartyUpdatePayload } from "@rushsite/shared";
import { DockButton, DockLink } from "@/components/layout/Dock";
import { useDockAction, type DockAction } from "@/components/layout/dockStore";
import { BannerChip, BannerPerson, InviteBanner } from "@/components/party/InviteBanner";
import { Card } from "@/components/ui/Card";
import { ApiError, api, steamLoginUrl, type InvitePreview } from "@/lib/api";
import { MODE_ART } from "@/lib/modes";
import { useSession } from "@/lib/session";
import styles from "./invite.module.css";

type Problem = { title: string; body: string; kind: "invalid" | "full" | "retry" | "signin" };

const INVALID: Problem = {
  kind: "invalid",
  title: "Invite expired",
  body: "The link is wrong or has expired. The leader may have made a new link or closed the party. Ask them for a fresh one.",
};
const FULL: Problem = { kind: "full", title: "Party is full", body: "Ask the leader to make room, or start your own party." };

function problemFor(e: unknown): Problem {
  if (e instanceof ApiError) {
    if (e.status === 404 || e.status === 410 || e.code === "invite_not_found" || e.code === "invite_expired") return INVALID;
    if (e.code === "party_full") return FULL;
    if (e.code === "party_locked") return { kind: "retry", title: "Party is in a match", body: "You can join after the match ends." };
    if (e.code === "party_changed") return { kind: "retry", title: "Party changed", body: "Your party changed while joining. Try again." };
    if (e.status === 401) return { kind: "signin", title: "Sign in to join", body: "Your session ended. Sign in again." };
  }
  return { kind: "retry", title: "Could not join", body: "Something went wrong. Try again in a moment." };
}

// Party invite link. The banner says who and how full, the dock holds Join
export function InviteView({ code }: { code: string }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
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
  const pending = loading || checking;
  const leader = preview?.leader;
  const open = preview ? Math.max(0, preview.capacity - preview.size) : 0;

  let dock: DockAction;
  if (pending) {
    dock = {
      label: "Party invite",
      value: "Checking the link",
      action: (
        <DockButton tone="quiet" disabled>
          Join party
        </DockButton>
      ),
    };
  } else if (member) {
    dock = { label: "Party invite", value: "You are in this party", action: <DockLink href="/play">Go to Play</DockLink> };
  } else if (problem?.kind === "invalid") {
    dock = {
      label: "Invite expired",
      value: "Ask for a fresh link",
      action: (
        <DockLink href="/play" tone="quiet">
          Go to Play
        </DockLink>
      ),
    };
  } else if (problem?.kind === "full") {
    dock = {
      label: "Party full",
      value: preview ? `${preview.size} of ${preview.capacity} players` : "No open slots",
      action: (
        <DockLink href="/play" tone="quiet">
          Start a party
        </DockLink>
      ),
    };
  } else if (!user || problem?.kind === "signin") {
    dock = {
      label: "Party invite",
      value: leader ? `From ${leader.displayName}` : "Sign in to join",
      action: (
        <DockLink href={steamLoginUrl(pathname)} external>
          Sign in to join
        </DockLink>
      ),
    };
  } else {
    dock = {
      label: problem ? problem.title : "Party invite",
      value: leader && preview ? `${leader.displayName} · ${preview.size} of ${preview.capacity}` : "Join the party",
      action: (
        <DockButton onClick={join} disabled={busy}>
          {busy ? "Joining" : problem ? "Try again" : "Join party"}
        </DockButton>
      ),
    };
  }
  useDockAction(dock);

  const title = pending ? "Party invite" : member ? "You are in" : problem ? problem.title : "You are invited";

  return (
    <div className={`container ${styles.page}`} aria-busy={pending}>
      <InviteBanner
        art={MODE_ART.rush3v3}
        kicker={pending ? "Checking the link" : "Party invite"}
        title={title}
        chips={
          preview && (
            <>
              <BannerChip tone={preview.full ? "loss" : "accent"}>
                {preview.size} of {preview.capacity} players
              </BannerChip>
              {!preview.full && (
                <BannerChip>
                  {open} open {open === 1 ? "slot" : "slots"}
                </BannerChip>
              )}
            </>
          )
        }
      >
        {leader && <BannerPerson person={leader} role="Party leader" />}
      </InviteBanner>

      {!pending && (
        <Card className={styles.note}>
          {problem ? (
            <p role="alert">{problem.body}</p>
          ) : member ? (
            <p className="muted">You are already in this party. Head to Play to pick modes with your team.</p>
          ) : (
            <>
              <p className="muted">
                {leader ? `${leader.displayName} picks the modes and starts the queue. ` : ""}A party can queue any mode whose teams are at least as big as the
                party.
              </p>
              {leavesParty && <p className={styles.warn}>Joining takes you out of your current party and cancels its queue.</p>}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
