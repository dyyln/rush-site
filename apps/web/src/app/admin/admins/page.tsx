"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Table, type Column } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { adminApi, errorMessage } from "../_lib/client";
import { ago } from "../_lib/format";
import { useLiveData, useNow } from "../_lib/live";
import type { AdminCandidateView, AdminListView, AdminView } from "../_lib/types";
import { ConfirmDialog, ErrorPanel, PageHeader } from "../_components/parts";
import styles from "../admin.module.css";

const nameOf = (a: { displayName?: string; steamId: string }) => a.displayName ?? a.steamId;

function AdminName({ admin }: { admin: { steamId: string; displayName?: string; avatarUrl?: string; signedIn: boolean } }) {
  const name = nameOf(admin);
  const body = (
    <>
      <Avatar name={admin.displayName ?? "?"} src={admin.avatarUrl ?? null} size="sm" />
      <span>{name}</span>
    </>
  );
  // Players who never signed in have no user page yet
  return admin.signedIn ? (
    <Link href={`/admin/users/${admin.steamId}`} className={styles.player}>
      {body}
    </Link>
  ) : (
    <span className={styles.player}>{body}</span>
  );
}

export default function AdminAdminsPage() {
  const toast = useToast();
  const now = useNow(60_000);
  const live = useLiveData(() => adminApi.admins(), [], { kinds: ["user"], pollMs: 60_000 });
  const [removing, setRemoving] = useState<AdminView | null>(null);
  const viewer = live.data?.viewer;

  const columns: Column<AdminView>[] = [
    { key: "admin", header: "Admin", skeleton: "avatar", cell: (a) => <AdminName admin={a} /> },
    { key: "steamId", header: "SteamID64", hideOnMobile: true, cell: (a) => <span className="mono">{a.steamId}</span> },
    {
      key: "role",
      header: "Role",
      skeleton: "chip",
      cell: (a) => (
        <span className={styles.actions}>
          {a.super ? <Badge tone="accent">Super</Badge> : <Badge>Admin</Badge>}
          {!a.signedIn && <Badge tone="info">Not signed in</Badge>}
        </span>
      ),
    },
    {
      key: "addedBy",
      header: "Added by",
      hideOnMobile: true,
      cell: (a) =>
        a.super ? (
          <span className={styles.muted}>ADMIN_STEAM_IDS</span>
        ) : a.addedBy ? (
          <Link href={`/admin/users/${a.addedBy}`}>{a.addedByName ?? a.addedBy}</Link>
        ) : null,
    },
    { key: "note", header: "Note", hideOnMobile: true, cell: (a) => a.note ?? <span className={styles.muted}>None</span> },
    {
      key: "added",
      header: "Added",
      hideOnMobile: true,
      cell: (a) =>
        a.createdAt ? (
          <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString("en-GB")} className={styles.nowrap}>
            {ago(a.createdAt, now)}
          </time>
        ) : (
          <span className={styles.muted}>Config</span>
        ),
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      cell: (a) => <RemoveCell admin={a} viewer={viewer} onRemove={() => setRemoving(a)} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Admins"
        description="Who can open this admin area. Super admins come from ADMIN_STEAM_IDS on the server and can only be changed there."
        updatedAt={live.updatedAt}
        refreshing={live.refreshing}
        onRefresh={live.reload}
      />
      {viewer?.canManage ? (
        <AddAdmin
          onAdded={(name) => {
            toast.push({ title: `${name} is now an admin`, tone: "success" });
            live.reload();
          }}
        />
      ) : viewer ? (
        <p className={styles.muted}>Only super admins can add or remove admins.</p>
      ) : null}
      {live.error && !live.data ? (
        <ErrorPanel error={live.error} onRetry={live.reload} what="the admin list" />
      ) : (
        <Table
          caption="Admins"
          columns={columns}
          rows={live.data?.admins ?? []}
          rowKey={(a) => a.steamId}
          loading={live.loading}
          highlight={(a) => a.steamId === viewer?.steamId}
          empty="No admins"
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing ? nameOf(removing) : ""} as admin?`}
        body={
          removing && (
            <div className="stack">
              <p>
                They lose access to the admin area at once. Other API instances catch up within 30 seconds.
              </p>
              <p className={`${styles.muted} mono`}>{removing.steamId}</p>
            </div>
          )
        }
        confirmLabel="Remove admin"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await adminApi.removeAdmin(removing.steamId);
          toast.push({ title: `${nameOf(removing)} removed as admin`, tone: "success" });
          live.reload();
        }}
      />
    </>
  );
}

function RemoveCell({ admin, viewer, onRemove }: { admin: AdminView; viewer?: AdminListView["viewer"]; onRemove: () => void }) {
  if (!viewer?.canManage) return null;
  if (admin.steamId === viewer.steamId) return <span className={styles.muted}>You</span>;
  if (admin.super) return <span className={styles.muted}>Set in config</span>;
  return (
    <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${nameOf(admin)} as admin`}>
      Remove
    </Button>
  );
}

function AddAdmin({ onAdded }: { onAdded: (name: string) => void }) {
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [found, setFound] = useState<AdminCandidateView | null>(null);
  const [error, setError] = useState<string>();
  const [looking, setLooking] = useState(false);
  const [adding, setAdding] = useState(false);

  async function lookup() {
    if (!query.trim()) return setError("Enter a SteamID64 or a Steam profile URL");
    setLooking(true);
    setFound(null);
    setError(undefined);
    try {
      setFound(await adminApi.adminCandidate(query.trim()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLooking(false);
    }
  }

  async function add() {
    if (!found) return;
    setAdding(true);
    try {
      await adminApi.addAdmin(found.steamId, note.trim() || undefined);
      onAdded(nameOf(found));
      setQuery("");
      setNote("");
      setFound(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card title="Add an admin">
      <form
        className={styles.formGrid}
        onSubmit={(e) => {
          e.preventDefault();
          void lookup();
        }}
      >
        <div className={styles.formWide}>
          <Input
            label="SteamID64 or profile URL"
            placeholder="https://steamcommunity.com/profiles/76561198000000000"
            value={query}
            error={found ? undefined : error}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setFound(null);
              setError(undefined);
            }}
          />
        </div>
        <div className={styles.formWide}>
          <Input label="Note (optional)" value={note} maxLength={200} hint="Why they have access, for example cup moderator" onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className={`${styles.actions} ${styles.formWide}`}>
          <Button type="submit" variant="secondary" loading={looking}>
            Look up
          </Button>
        </div>
      </form>
      {found && (
        <div className="stack" style={{ marginTop: "var(--space-4)" }} aria-live="polite">
          <div className={styles.found}>
            <AdminName admin={found} />
            <span className={`${styles.muted} mono`}>{found.steamId}</span>
            {found.profileUrl && (
              <a href={found.profileUrl} target="_blank" rel="noreferrer noopener">
                Steam profile
              </a>
            )}
          </div>
          {!found.displayName && <p className={styles.muted}>Steam returned no profile for this id. Check it before adding.</p>}
          {found.displayName && !found.signedIn && (
            <p className={styles.muted}>They have never signed in here. Access starts at their first sign in.</p>
          )}
          {found.admin ? (
            <p role="status">{found.admin === "super" ? "Already a super admin." : "Already an admin."}</p>
          ) : (
            <div className={styles.actions}>
              <Button onClick={() => void add()} loading={adding}>
                Add {nameOf(found)} as admin
              </Button>
              <Button variant="ghost" onClick={() => setFound(null)}>
                Cancel
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className={styles.loss}>
              {error}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
