"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { isMock } from "@/lib/env";
import { adminApi, errorMessage } from "../_lib/client";
import { ago, TRUST_LABEL, trustTone } from "../_lib/format";
import { useLiveData } from "../_lib/live";
import { mockAdmin } from "../_lib/mock";
import type { UserSearchHit } from "../_lib/types";
import { ManualBan } from "../_components/ManualBan";
import { ErrorPanel, PageHeader } from "../_components/parts";
import styles from "../admin.module.css";

// A SteamID64 or a steamcommunity.com/profiles/ URL goes straight to the user page
function parseSteamId(input: string): string | null {
  const s = input.trim();
  if (/^\d{17}$/.test(s)) return s;
  const m = s.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  return m ? m[1]! : null;
}

const isVanityUrl = (input: string) => /steamcommunity\.com\/id\//i.test(input);

type Results = { q: string; users: UserSearchHit[] };

const NEWEST = 20;

export default function AdminUsersPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const newest = useLiveData(() => adminApi.newestUsers(NEWEST), [], { kinds: ["user"], pollMs: 60_000 });

  async function submit() {
    const q = value.trim();
    const id = parseSteamId(q);
    if (id) return router.push(`/admin/users/${id}`);
    setBusy(true);
    setError(undefined);
    try {
      if (isVanityUrl(q)) {
        const r = await adminApi.resolveProfile(q);
        return router.push(`/admin/users/${r.steamId}`);
      }
      if (q.length < 2) return setError("Enter at least 2 characters of a name, or a SteamID64");
      setResults({ q, users: await adminApi.searchUsers(q) });
      requestAnimationFrame(() => resultsRef.current?.focus());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Find a player by name, SteamID64 or Steam profile URL to see trust signals, ratings and history."
        updatedAt={results ? undefined : newest.updatedAt}
        refreshing={results ? undefined : newest.refreshing}
        onRefresh={results ? undefined : newest.reload}
      />
      <Card>
        <form
          className={styles.formRow}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            label="Name, SteamID64 or profile URL"
            placeholder="vexa or 76561198000000000"
            autoComplete="off"
            maxLength={200}
            value={value}
            error={error}
            onChange={(e) => {
              setValue(e.target.value);
              setError(undefined);
            }}
          />
          <Button type="submit" loading={busy}>
            Search
          </Button>
          {results && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setResults(null);
                setValue("");
                setError(undefined);
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </Card>

      {results && (
        <section className={styles.section} aria-labelledby="user-results">
          <h2 id="user-results" ref={resultsRef} tabIndex={-1} className={styles.sectionTitle}>
            {results.users.length === 0
              ? `No players match "${results.q}"`
              : `${results.users.length}${results.users.length >= 20 ? "+" : ""} ${results.users.length === 1 ? "player matches" : "players match"} "${results.q}"`}
          </h2>
          {results.users.length > 0 && <UserHits users={results.users} show="seen" />}
          {results.users.length >= 20 && <p className={styles.muted}>Showing the first 20. Type more of the name to narrow it down.</p>}
        </section>
      )}

      {!results && (
        <section className={styles.section} aria-labelledby="newest-users">
          <h2 id="newest-users" className={styles.sectionTitle}>
            Newest players
          </h2>
          {newest.error && !newest.data ? (
            <ErrorPanel error={newest.error} onRetry={newest.reload} what="the newest players" />
          ) : !newest.data ? (
            <p className={styles.muted} aria-busy="true">
              Loading
            </p>
          ) : newest.data.length === 0 ? (
            <p className={styles.muted}>No players have signed up yet.</p>
          ) : (
            <UserHits users={newest.data} show="joined" />
          )}
        </section>
      )}

      <ManualBan />
      {isMock && (
        <Card title="Sample players">
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {mockAdmin.sampleSteamIds().map((id) => (
              <li key={id}>
                <Link href={`/admin/users/${id}`} className="mono">
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// Joined shows the sign up time first, for spotting new accounts
function UserHits({ users, show }: { users: UserSearchHit[]; show: "joined" | "seen" }) {
  const now = Date.now();
  return (
    <ul className={styles.hitList}>
      {users.map((u) => (
        <li key={u.steamId}>
          <Link href={`/admin/users/${u.steamId}`} className={styles.hit}>
            <Avatar name={u.displayName} src={u.avatarUrl} />
            <span className={styles.hitText}>
              <span className={styles.hitName}>{u.displayName}</span>
              <span className={`${styles.muted} mono`}>{u.steamId}</span>
            </span>
            <span className={styles.hitMeta}>
              {u.banned && <Badge tone="loss">Banned</Badge>}
              {u.trustLevel && <Badge tone={trustTone(u.trustLevel)}>{TRUST_LABEL[u.trustLevel] ?? u.trustLevel}</Badge>}
              {show === "joined" ? (
                <span className={styles.muted}>Joined {ago(u.createdAt, now)}</span>
              ) : (
                <span className={styles.muted}>Seen {ago(u.lastLoginAt, now)}</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
