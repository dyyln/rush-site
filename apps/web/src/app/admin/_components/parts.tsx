"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { errorMessage } from "../_lib/client";
import { ago, matchTone } from "../_lib/format";
import { useNow } from "../_lib/live";
import type { MatchSummaryView, UserCard } from "../_lib/types";
import styles from "../admin.module.css";

export function PageHeader({
  title,
  description,
  updatedAt,
  refreshing,
  onRefresh,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  updatedAt?: number | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className={styles.headerMeta}>
        {updatedAt !== undefined && <Updated at={updatedAt ?? null} />}
        {actions}
        {onRefresh && (
          <Button variant="secondary" onClick={onRefresh} loading={refreshing}>
            Refresh
          </Button>
        )}
      </div>
    </header>
  );
}

function Updated({ at }: { at: number | null }) {
  const now = useNow();
  return (
    <span className={styles.muted} aria-live="off">
      {at ? `Updated ${ago(new Date(at).toISOString(), now)}` : "Loading"}
    </span>
  );
}

export function ErrorPanel({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  return (
    <div className={styles.error} role="alert">
      <p>
        Could not load {what}. {errorMessage(error)}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function PlayerLink({ player }: { player: UserCard }) {
  return (
    <Link href={`/admin/users/${player.steamId}`} className={styles.player}>
      <Avatar name={player.displayName} src={player.avatarUrl} size="sm" />
      <span>{player.displayName}</span>
    </Link>
  );
}

export function PlayerList({ players }: { players: UserCard[] }) {
  return (
    <div className={styles.players}>
      {players.map((p) => (
        <PlayerLink key={p.steamId} player={p} />
      ))}
    </div>
  );
}

// One line per team with plain name links, compact enough for table rows
export function Teams({ teams }: { teams: MatchSummaryView["teams"] }) {
  return (
    <div className={styles.teams}>
      {teams.map((t, i) => (
        <p key={t.name} className={styles.teamLine}>
          {i > 0 && <span className={styles.vs}>vs </span>}
          {t.players.map((p, j) => (
            <span key={p.steamId}>
              {j > 0 && ", "}
              <Link href={`/admin/users/${p.steamId}`}>{p.displayName}</Link>
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

export function MatchStatus({ status }: { status: string }) {
  return <Badge tone={matchTone(status)}>{status}</Badge>;
}

export function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "off" }) {
  return (
    <span
      className={cx(styles.dot, tone === "ok" && styles.dotOk, tone === "warn" && styles.dotWarn, tone === "bad" && styles.dotBad)}
      aria-hidden="true"
    />
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className={cx(styles.meterFill, frac >= 1 && styles.meterFull)} style={{ width: `${frac * 100}%` }} />
    </div>
  );
}

type ConfirmProps = {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  // Asks for a reason when set. Required reasons block the confirm button until filled
  reason?: "required" | "optional";
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
};

export function ConfirmDialog({ open, title, body, confirmLabel, reason, danger, onClose, onConfirm }: ConfirmProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const blocked = reason === "required" && text.trim().length === 0;

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(text.trim());
      setText("");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={submit} loading={busy} disabled={blocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div>{body}</div>
        {reason && (
          <Input
            label={reason === "required" ? "Reason" : "Reason (optional)"}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !blocked && !busy) void submit();
            }}
          />
        )}
        {error && (
          <p role="alert" className={styles.loss}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

// Heading plus content without a card frame. Tables bring their own border
export function Section({ id, title, actions, children }: { id?: string; title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-label={typeof title === "string" ? title : undefined}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
