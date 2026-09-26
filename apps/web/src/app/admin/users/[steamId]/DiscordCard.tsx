"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { adminApi, errorMessage } from "../../_lib/client";
import { ago, stamp } from "../../_lib/format";
import { useLiveData } from "../../_lib/live";
import { ConfirmDialog, ErrorPanel } from "../../_components/parts";
import styles from "../../admin.module.css";

const YEAR = 365.25 * 86_400_000;

export function DiscordCard({ steamId, name, now }: { steamId: string; name: string; now: number }) {
  const live = useLiveData(() => adminApi.discord(steamId), [steamId], { kinds: ["user"], pollMs: 60_000 });
  const toast = useToast();
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const d = live.data;
  const l = d?.link;

  if (live.error && !d) return <ErrorPanel error={live.error} onRetry={live.reload} what="the Discord link" />;
  if (d && !d.enabled && !l) return null;

  async function sync() {
    try {
      await adminApi.discordSync(steamId);
      toast.push({ title: "Discord role synced", tone: "success" });
    } catch (e) {
      toast.push({ title: "Could not sync", body: errorMessage(e), tone: "error" });
    }
    live.reload();
  }

  return (
    <Card title="Discord" eyebrow={l ? `Linked ${ago(l.linkedAt, now)}` : undefined}>
      {!d ? (
        <p className="muted" aria-busy="true">
          Loading
        </p>
      ) : !l ? (
        <p className="muted">Not linked.</p>
      ) : (
        <div className="stack">
          <dl className={styles.dl}>
            <dt>Account</dt>
            <dd>
              {l.globalName ? `${l.globalName}, ` : ""}
              <span className="mono">@{l.username}</span>
            </dd>
            <dt>Discord id</dt>
            <dd className="mono">{l.discordId}</dd>
            <dt>Created</dt>
            <dd title={stamp(l.discordCreatedAt)}>{Math.floor(((now - Date.parse(l.discordCreatedAt)) / YEAR) * 10) / 10} years ago</dd>
            <dt>Server access</dt>
            <dd>
              <Badge tone={l.roleGranted ? "win" : "warn"}>{l.roleGranted ? "Linked role" : "No role"}</Badge>
              {l.syncError && <span className={styles.muted}>, {l.syncError === "not_in_server" ? "not in the server" : l.syncError}</span>}
            </dd>
            <dt>Last sync</dt>
            <dd>{l.syncedAt ? ago(l.syncedAt, now) : "Never"}</dd>
          </dl>
          <div className="row">
            {d.enabled && (
              <Button variant="secondary" onClick={sync}>
                Sync role
              </Button>
            )}
            <Button variant="danger" onClick={() => setUnlinkOpen(true)}>
              Unlink
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={unlinkOpen}
        title="Unlink Discord"
        body={<p>Removes the link and the Linked role from {name}. They stay in the server and can link again.</p>}
        confirmLabel="Unlink"
        danger
        onClose={() => setUnlinkOpen(false)}
        onConfirm={async () => {
          await adminApi.discordUnlink(steamId);
          toast.push({ title: "Discord unlinked", tone: "success" });
          live.reload();
        }}
      />
    </Card>
  );
}
