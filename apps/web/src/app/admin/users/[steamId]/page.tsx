"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { TRUST_LEVELS, type TrustLevel } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Table, type Column } from "@/components/ui/Table";
import { TierChip } from "@/components/ui/TierChip";
import { useToast } from "@/components/ui/Toast";
import { formatStat } from "@/lib/format";
import { useSession } from "@/lib/session";
import { MODE_COPY, mapName } from "@/lib/modes";
import { adminApi, errorMessage, isNotFound } from "../../_lib/client";
import { ago, scoreLine, shortId, stamp, TRUST_LABEL, trustTone } from "../../_lib/format";
import { useLiveData, useNow } from "../../_lib/live";
import type { AuditEntry, UserDetailView } from "../../_lib/types";
import { CancelMatchDialog } from "../../_components/CancelMatchDialog";
import { ActivityCard } from "./ActivityCard";
import { DiscordCard } from "./DiscordCard";
import { ConfirmDialog, ErrorPanel, MatchStatus, PageHeader } from "../../_components/parts";
import styles from "../../admin.module.css";

type Signal = UserDetailView["trustSignals"][number];
type RecentMatch = UserDetailView["recentMatches"][number];

const DAY = 86_400_000;

const BAN_DURATIONS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "perm", label: "Permanent" },
];

export default function AdminUserPage() {
  const { steamId } = useParams<{ steamId: string }>();
  const live = useLiveData(() => adminApi.user(steamId), [steamId], { kinds: ["user"], pollMs: 60_000 });
  const now = useNow(10_000);
  const toast = useToast();
  const { user: me } = useSession();
  const [banOpen, setBanOpen] = useState(false);
  const [unbanOpen, setUnbanOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const u = live.data;
  const cooldown = u?.cooldowns[0];

  if (live.error && !u) {
    return (
      <>
        <PageHeader title="User" description={<span className="mono">{steamId}</span>} />
        {isNotFound(live.error) ? (
          <p className="muted">
            No user with this SteamID64 has signed in. <Link href="/admin/users">Look up another</Link>
          </p>
        ) : (
          <ErrorPanel error={live.error} onRetry={live.reload} what="the user" />
        )}
      </>
    );
  }

  const done = (title: string) => {
    toast.push({ title, tone: "success" });
    live.reload();
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.profileHead}>
          <Avatar name={u?.user.displayName ?? "?"} src={u?.user.avatarUrl} size="lg" />
          <div className="stack" style={{ gap: "var(--space-2)" }}>
            <h1>{u?.user.displayName ?? "Loading"}</h1>
            <div className="row">
              <span className="mono muted">{steamId}</span>
              {u?.trust && <Badge tone={trustTone(u.trust.level)}>{TRUST_LABEL[u.trust.level]}</Badge>}
              {u?.trust?.locked && <Badge>Locked by admin</Badge>}
              {u?.activeBan && <Badge tone="loss">Banned</Badge>}
            </div>
          </div>
        </div>
        <div className={styles.headerMeta}>
          <Link href={`/profile/${steamId}`}>Public profile</Link>
          {u?.user.profileUrl && (
            <a href={u.user.profileUrl} target="_blank" rel="noreferrer">
              Steam
            </a>
          )}
          <Button variant="secondary" onClick={live.reload} loading={live.refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {!u ? (
        <p className="muted">Loading</p>
      ) : (
        <div className={styles.split}>
          <div className={styles.col}>
            <Card title="Trust signals" eyebrow={u.trust ? `Reason: ${u.trust.reason || "none"}` : "No trust row yet"}>
              {u.trustSignals.length === 0 ? (
                <p className="muted">No checks recorded.</p>
              ) : (
                <div className="stack">
                  {u.trustSignals.map((s) => (
                    <SignalRow key={s.id} signal={s} now={now} />
                  ))}
                </div>
              )}
            </Card>

            <Table
              caption="Ratings"
              captionHidden={false}
              columns={ratingColumns}
              rows={u.ratings}
              rowKey={(r) => r.mode}
              empty="No rated matches."
            />

            <Table
              caption="Recent matches"
              captionHidden={false}
              columns={matchColumns(now)}
              rows={u.recentMatches}
              rowKey={(m) => m.id}
              empty="No matches."
            />

            <ActivityCard steamId={steamId} now={now} />
          </div>

          <div className={styles.col}>
            <Card title="Right now">
              <UserState
                state={u.state}
                now={now}
                onRemove={() => setRemoveOpen(true)}
                onCancel={() => setCancelOpen(true)}
              />
            </Card>

            <Card title="Actions">
              <div className="stack">
                <TrustForm
                  steamId={steamId}
                  current={u.trust?.level ?? "new"}
                  onDone={() => done("Trust level updated")}
                />
                <div className="row">
                  {u.activeBan ? (
                    <Button variant="secondary" onClick={() => setUnbanOpen(true)}>
                      Unban
                    </Button>
                  ) : (
                    <Button variant="danger" onClick={() => setBanOpen(true)} disabled={me?.steamId === steamId}>
                      Ban
                    </Button>
                  )}
                </div>
                {cooldown && (
                  <div className="stack" style={{ gap: "var(--space-2)" }}>
                    <p className={styles.muted}>
                      Queue cooldown for {cooldown.reason}, offence {cooldown.offence}, ends {ago(cooldown.endsAt, now)}.
                    </p>
                    <div className="row">
                      <Button variant="secondary" onClick={() => setClearOpen(true)}>
                        Clear cooldown
                      </Button>
                    </div>
                  </div>
                )}
                {u.activeBan && (
                  <p className={styles.muted}>
                    Banned {ago(u.activeBan.createdAt, now)} for {u.activeBan.reason}.{" "}
                    {u.activeBan.expiresAt ? `Ends ${stamp(u.activeBan.expiresAt)}.` : "Permanent."}
                  </p>
                )}
              </div>
            </Card>

            <Card title="Account">
              <dl className={styles.dl}>
                <dt>Joined</dt>
                <dd>{stamp(u.user.createdAt)}</dd>
                <dt>Last login</dt>
                <dd>{ago(u.user.lastLoginAt, now)}</dd>
                <dt>Region</dt>
                <dd>
                  {u.user.region.toUpperCase()}
                  {u.user.countryCode ? `, ${u.user.countryCode}` : ""}
                </dd>
                <dt>Steam account</dt>
                <dd>{u.steam?.accountCreatedAt ? `${Math.floor((now - Date.parse(u.steam.accountCreatedAt)) / DAY / 365.25 * 10) / 10} years` : "Hidden"}</dd>
                <dt>CS2 hours</dt>
                <dd className="mono">{u.steam?.cs2PlaytimeMinutes != null ? Math.round(u.steam.cs2PlaytimeMinutes / 60) : "Hidden"}</dd>
                <dt>Reports</dt>
                <dd>
                  {u.reports.received} received, {u.reports.open} open
                </dd>
                <dt>Flags</dt>
                <dd>
                  {u.flags.total} total, {u.flags.open} open
                </dd>
                <dt>Cooldown</dt>
                <dd>
                  {u.cooldowns[0]
                    ? `${u.cooldowns[0].reason}, offence ${u.cooldowns[0].offence}, ends ${ago(u.cooldowns[0].endsAt, now)}`
                    : "None"}
                </dd>
              </dl>
            </Card>

            <DiscordCard steamId={steamId} name={u.user.displayName} now={now} />

            <Card title="Bans">
              {u.bans.length === 0 ? (
                <p className="muted">Never banned.</p>
              ) : (
                <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {u.bans.map((b) => (
                    <li key={b.id} className="stack" style={{ gap: "var(--space-1)" }}>
                      <span className="row">
                        <Badge tone={b.active ? "loss" : "neutral"}>{b.active ? "Active" : b.revokedAt ? "Revoked" : "Expired"}</Badge>
                        <span>{b.reason}</span>
                      </span>
                      <span className={styles.muted}>
                        {stamp(b.createdAt)}, {b.expiresAt ? `until ${stamp(b.expiresAt)}` : "permanent"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Admin log">
              {u.audit.length === 0 ? (
                <p className="muted">No admin actions on this user.</p>
              ) : (
                <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {u.audit.map((a) => (
                    <li key={a.id}>
                      <AuditLine entry={a} now={now} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={clearOpen}
        title="Clear cooldown"
        body={
          <p>
            Ends the running queue cooldown for {u?.user.displayName} now so they can queue again. The offence still counts toward
            their next cooldown.
          </p>
        }
        confirmLabel="Clear cooldown"
        onClose={() => setClearOpen(false)}
        onConfirm={async () => {
          await adminApi.clearCooldown(steamId);
          done("Cooldown cleared");
        }}
      />
      <ConfirmDialog
        open={removeOpen}
        title="Remove from queue"
        body={<p>Removes {u?.user.displayName}&apos;s party from every mode. The party is told they left the queue.</p>}
        confirmLabel="Remove"
        reason="optional"
        danger
        onClose={() => setRemoveOpen(false)}
        onConfirm={async (reason) => {
          if (!u?.state.queue) return;
          await adminApi.removeTicket(u.state.queue.ticketId, reason || undefined);
          done("Removed from queue");
        }}
      />
      <CancelMatchDialog match={cancelOpen && u?.state.match ? u.state.match : null} onClose={() => setCancelOpen(false)} onDone={() => done("Match cancelled")} />
      <BanDialog open={banOpen} steamId={steamId} name={u?.user.displayName ?? steamId} onClose={() => setBanOpen(false)} onDone={() => done("User banned")} />
      <ConfirmDialog
        open={unbanOpen}
        title="Unban"
        body={<p>Revokes every active ban on {u?.user.displayName}. Rolled back ratings are not restored.</p>}
        confirmLabel="Unban"
        onClose={() => setUnbanOpen(false)}
        onConfirm={async () => {
          await adminApi.unban(steamId);
          done("User unbanned");
        }}
      />
    </>
  );
}

const ratingColumns: Column<UserDetailView["ratings"][number]>[] = [
  { key: "mode", header: "Mode", cell: (r) => MODE_COPY[r.mode].label },
  { key: "rating", header: "Rating", cell: (r) => <TierChip rating={r.rating} size="sm" /> },
  { key: "rd", header: "RD", numeric: true, hideOnMobile: true, cell: (r) => Math.round(r.rd) },
  { key: "played", header: "Matches", numeric: true, cell: (r) => r.matchesPlayed },
  { key: "wl", header: "W / L", numeric: true, hideOnMobile: true, cell: (r) => `${r.wins} / ${r.losses}` },
  { key: "winrate", header: "Win %", numeric: true, cell: (r) => formatStat(r.wins / r.matchesPlayed, "pct", r.matchesPlayed) },
];

function matchColumns(now: number): Column<RecentMatch>[] {
  return [
    {
      key: "id",
      header: "Match",
      cell: (m) => (
        <Link href={`/admin/matches/${m.id}`} className="mono">
          {shortId(m.id)}
        </Link>
      ),
    },
    {
      key: "mode",
      header: "Mode",
      cell: (m) => (
        <span className="stack" style={{ gap: 0 }}>
          <span>{MODE_COPY[m.mode].short}</span>
          {m.mapId && <span className={`${styles.muted} mono`}>{mapName(m.mode, m.mapId)}</span>}
        </span>
      ),
    },
    {
      key: "result",
      header: "Result",
      cell: (m) =>
        m.abandoned ? (
          <Badge tone="loss">Left</Badge>
        ) : m.won === null ? (
          <MatchStatus status={m.status} />
        ) : (
          <span className={cx(styles.nowrap, m.won ? styles.win : styles.loss)}>
            {m.won ? "Win" : "Loss"} <span className="mono">{ownScore(m)}</span>
          </span>
        ),
    },
    {
      key: "kd",
      header: "K/D",
      numeric: true,
      hideOnMobile: true,
      cell: (m) => formatStat(m.kills === null ? null : m.kills / Math.max(1, m.deaths ?? 0), "kd"),
    },
    {
      key: "hs",
      header: "HS %",
      numeric: true,
      hideOnMobile: true,
      cell: (m) => formatStat(m.kills && m.headshots !== null ? m.headshots / m.kills : null, "pct"),
    },
    { key: "when", header: "When", numeric: true, cell: (m) => <span className={styles.nowrap}>{ago(m.createdAt, now)}</span> },
  ];
}

// Own team score first. Team 0 is the first key in the score record
function ownScore(m: RecentMatch): string {
  const values = Object.values(m.score ?? {});
  if (values.length !== 2) return scoreLine(m.score);
  return (m.team === 0 ? values : [...values].reverse()).join(" : ");
}

const SOURCE_LABEL: Record<string, string> = {
  steam_bans: "Steam bans",
  steam_profile: "Steam profile",
  faceit: "FACEIT",
  platform: "Platform history",
};

function signalSummary(s: Signal): string {
  const d = s.data as Record<string, unknown> | null;
  if (d === null || d === undefined) return s.source === "faceit" ? "No account, neutral" : "No data";
  if (s.source === "steam_bans") {
    const vac = Number(d.NumberOfVACBans ?? 0);
    const game = Number(d.NumberOfGameBans ?? 0);
    if (vac + game === 0 && !d.CommunityBanned) return "No bans";
    return `${vac} VAC, ${game} game${d.CommunityBanned ? ", community banned" : ""}, last ${d.DaysSinceLastBan ?? "?"} days ago`;
  }
  if (s.source === "faceit") {
    if (d.banned) return `Banned on FACEIT${d.banReason ? `: ${d.banReason}` : ""}`;
    const parts = [d.nickname && `${d.nickname}`, d.skillLevel && `level ${d.skillLevel}`, d.matchesPlayed !== undefined && `${d.matchesPlayed} matches`];
    if (Number(d.pastBans ?? 0) > 0) parts.push(`${d.pastBans} past bans`);
    return parts.filter(Boolean).join(", ");
  }
  return Object.entries(d)
    .slice(0, 4)
    .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join("/") || "none" : String(v)}`)
    .join(", ");
}

function SignalRow({ signal: s, now }: { signal: Signal; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: "var(--space-2)" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row">
          <Badge tone={s.clean ? "win" : "loss"}>{s.clean ? "Clean" : "Flag"}</Badge>
          <strong>{SOURCE_LABEL[s.source] ?? s.source}</strong>
        </span>
        <span className="row">
          <span className={styles.muted}>{ago(s.fetchedAt, now)}</span>
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Raw"}
          </Button>
        </span>
      </div>
      <p className={styles.muted}>{signalSummary(s)}</p>
      {open && <pre className={styles.code}>{JSON.stringify(s.data, null, 2)}</pre>}
    </div>
  );
}

function AuditLine({ entry: a, now }: { entry: AuditEntry; now: number }) {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  const what =
    a.action === "user.ban"
      ? `Banned${p.until ? ` until ${stamp(String(p.until))}` : " permanently"}: ${p.reason}`
      : a.action === "user.unban"
        ? "Unbanned"
        : a.action === "user.trust"
          ? `Trust set to ${TRUST_LABEL[String(p.level)] ?? p.level}${p.before ? ` from ${TRUST_LABEL[String(p.before)] ?? p.before}` : ""}`
          : a.action === "chat.mute"
            ? `Muted in chat${p.until ? ` until ${stamp(String(p.until))}` : " until lifted"}: ${p.reason}`
            : a.action === "chat.unmute"
              ? "Chat mute lifted"
              : a.action === "chat.delete"
                ? `Chat message deleted: ${p.body}`
                : a.action === "chat.refused"
                  ? `Chat message blocked by the filter (${p.code}): ${p.body}`
                  : a.action === "user.cooldown_clear"
                    ? "Queue cooldown cleared"
                    : a.action === "user.discord_unlink"
                      ? `Discord unlinked: @${p.username}`
                      : a.action === "user.discord_sync"
                        ? `Discord role synced${p.roleGranted ? "" : `, not granted${p.error ? ` (${p.error})` : ""}`}`
                        : a.action;
  return (
    <span className="stack" style={{ gap: 0 }}>
      <span>{what}</span>
      <span className={styles.muted}>
        by{" "}
        <Link href={`/admin/users/${a.adminSteamId}`} className={a.adminName ? undefined : "mono"}>
          {a.adminName ?? a.adminSteamId}
        </Link>
        , {ago(a.createdAt, now)}
      </span>
    </span>
  );
}

function UserState({
  state,
  now,
  onRemove,
  onCancel,
}: {
  state: UserDetailView["state"];
  now: number;
  onRemove: () => void;
  onCancel: () => void;
}) {
  if (!state.queue && !state.match) return <p className="muted">Not in a queue or a match.</p>;
  return (
    <div className="stack">
      {state.queue && (
        <div className={styles.stateLine}>
          <Badge tone="info">In queue</Badge>
          <span>
            {state.queue.modes.map((m) => MODE_COPY[m].label).join(", ")}, queued {ago(state.queue.enqueuedAt, now)}
          </span>
          <Button variant="secondary" onClick={onRemove}>
            Remove from queue
          </Button>
        </div>
      )}
      {state.match && (
        <div className={styles.stateLine}>
          <MatchStatus status={state.match.status} />
          <span>
            {MODE_COPY[state.match.mode].label} match{" "}
            <Link href={`/admin/matches/${state.match.id}`} className="mono">
              {state.match.slug ?? shortId(state.match.id)}
            </Link>
          </span>
          <Button variant="danger" onClick={onCancel}>
            Cancel match
          </Button>
        </div>
      )}
    </div>
  );
}

function TrustForm({ steamId, current, onDone }: { steamId: string; current: TrustLevel; onDone: () => void }) {
  const [level, setLevel] = useState<TrustLevel>(current);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <form
      className={styles.formRow}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await adminApi.setTrust(steamId, level);
          onDone();
        } catch (err) {
          toast.push({ title: "Could not set trust", body: errorMessage(err), tone: "error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Select
        label="Trust level"
        value={level}
        onChange={(e) => setLevel(e.target.value as TrustLevel)}
        options={TRUST_LEVELS.map((l) => ({ value: l, label: TRUST_LABEL[l] ?? l }))}
      />
      <Button type="submit" variant="secondary" loading={busy} disabled={level === current}>
        Set
      </Button>
    </form>
  );
}

function BanDialog({
  open,
  steamId,
  name,
  onClose,
  onDone,
}: {
  open: boolean;
  steamId: string;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const until = days === "perm" ? null : new Date(Date.now() + Number(days) * DAY).toISOString();
      await adminApi.ban(steamId, reason.trim(), until);
      setReason("");
      onClose();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Ban ${name}`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length === 0}>
            Ban
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>Removes them from the queue and blocks queueing and cup entry until the ban ends.</p>
        <Input label="Reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        <Select label="Duration" value={days} onChange={(e) => setDays(e.target.value)} options={BAN_DURATIONS} />
        {error && (
          <p role="alert" className={styles.loss}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
