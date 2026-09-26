"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SignInLink } from "@/components/ui/SignInLink";
import { cx } from "@/components/ui/cx";
import btn from "@/components/ui/Button.module.css";
import { ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { DiscordStatus } from "@/lib/types";
import styles from "./settings.module.css";

// What the api reports back after the Discord round trip
const OUTCOME: Record<string, { text: string; ok: boolean }> = {
  joined: { text: "Linked. You have been added to the server.", ok: true },
  linked: { text: "Linked. The rest of the server is open to you now.", ok: true },
  cancelled: { text: "Linking was cancelled.", ok: false },
  taken: { text: "That Discord account is already linked to another player.", ok: false },
  expired: { text: "The link request expired. Try again.", ok: false },
  failed: { text: "Discord could not be reached. Try again in a minute.", ok: false },
  signed_out: { text: "Sign in first, then link Discord.", ok: false },
  disabled: { text: "Discord linking is not available right now.", ok: false },
};

function accessText(s: DiscordStatus): string {
  const l = s.link!;
  if (l.roleGranted) return "You have access to every channel on the server.";
  if (l.syncError === "not_in_server") return "You are not in the server. Join with the invite, then press Check again.";
  return "We could not give you access yet. Press Check again in a minute.";
}

export function DiscordPanel() {
  const { user, loading } = useSession();
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const o = q.get("discord");
    if (!o) return;
    setOutcome(o);
    q.delete("discord");
    const rest = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (!user) return;
    api.discord
      .status()
      .then(setStatus)
      .catch(() => setError("Could not load your Discord link."));
  }, [user]);

  async function run(fn: () => Promise<DiscordStatus>) {
    setError(null);
    setOutcome(null);
    try {
      setStatus(await fn());
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? "Too many tries. Wait a minute." : "Discord could not be reached. Try again.");
    }
  }

  if (!loading && user && status && !status.enabled) return null;

  const note = outcome ? OUTCOME[outcome] : undefined;
  const invite = status?.inviteUrl;
  const link = status?.link;

  return (
    <Card title="Discord" id="discord">
      <div className={styles.panel}>
        {note && (
          <p role="status" className={note.ok ? styles.ok : styles.warn}>
            {note.text}
          </p>
        )}
        {error && (
          <p role="alert" className={styles.warn}>
            {error}
          </p>
        )}
        {!loading && !user ? (
          <>
            <p className="muted">Sign in, then link your Discord account to open the rest of the community server.</p>
            <div className="row">
              <SignInLink returnTo="/settings" />
            </div>
          </>
        ) : !status ? (
          <p className="muted" aria-busy="true">
            Loading
          </p>
        ) : !link ? (
          <>
            <p className="muted">
              Link your Discord account to open the rest of the community server. If you are not in the server yet, linking adds you.
            </p>
            <div className="row">
              <a href={api.discord.linkUrl()} className={cx(btn.button, btn.primary, btn.md)}>
                <span>Link Discord</span>
              </a>
            </div>
          </>
        ) : (
          <>
            <div className={styles.discordUser}>
              <Avatar name={link.globalName ?? link.username} src={link.avatarUrl} />
              <div className={styles.discordName}>
                <span>{link.globalName ?? link.username}</span>
                <span className="muted mono">@{link.username}</span>
              </div>
              <Badge tone={link.roleGranted ? "win" : "warn"}>{link.roleGranted ? "Access on" : "No access"}</Badge>
            </div>
            <p className="muted">{accessText(status)}</p>
            <div className="row">
              {invite && (
                <a href={invite} target="_blank" rel="noopener noreferrer" className={cx(btn.button, btn.secondary, btn.md)}>
                  <span>Open the server</span>
                </a>
              )}
              {!link.roleGranted && (
                <Button variant="secondary" onClick={() => run(api.discord.sync)}>
                  Check again
                </Button>
              )}
              <Button variant="ghost" onClick={() => run(api.discord.unlink)}>
                Unlink
              </Button>
            </div>
            <p className="muted">Unlinking closes the server again until you link.</p>
          </>
        )}
      </div>
    </Card>
  );
}
