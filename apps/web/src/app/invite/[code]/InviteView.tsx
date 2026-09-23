"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export function InviteView({ code }: { code: string }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await api.party.join(code);
      router.push("/play");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join the party");
      setBusy(false);
    }
  }

  return (
    <div className="container page">
      <Card title="Party invite" tone="raised">
        <div className="stack">
          <p className="muted">
            Invite code <span className="mono">{code}</span>. Joining a party leaves any queue you are in.
          </p>
          {error && (
            <p role="alert" style={{ color: "var(--color-loss)" }}>
              {error}
            </p>
          )}
          {loading ? null : user ? (
            <Button size="lg" onClick={join} loading={busy}>
              Join party
            </Button>
          ) : (
            <ButtonLink href={`/login?returnTo=${encodeURIComponent(`/invite/${code}`)}`} size="lg">
              Sign in to join
            </ButtonLink>
          )}
        </div>
      </Card>
    </div>
  );
}
