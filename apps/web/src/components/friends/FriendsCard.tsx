"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { useFriendInvite, type InviteSource } from "@/components/party/useFriendInvite";
import { Card } from "@/components/ui/Card";
import { FriendRow } from "./FriendRow";
import { matchesQuery, sortByPresence } from "./presence";
import { SearchBox } from "./SearchBox";
import { usePending, useFriends } from "./store";
import { useJoinableModes } from "./useJoinQueue";
import styles from "./friends.module.css";

const SHOWN = 8;

type FriendsCardProps = Partial<InviteSource> & {
  // True when the viewer is solo and not queued, so a queued friend's modes can be joined
  canJoinQueue?: boolean;
};

// Friends who play here, under the party panel on /play. Steam-only friends live on /friends
export function FriendsCard({ canJoinQueue, ...invite }: FriendsCardProps) {
  const { data, error } = useFriends();
  const { data: pending } = usePending();
  const actions = useFriendInvite(invite);
  const joinable = useJoinableModes({ ready: canJoinQueue });
  const [query, setQuery] = useState("");
  const [offlineOpen, setOfflineOpen] = useState(false);
  const offlineId = useId();

  const friends = useMemo(() => sortByPresence(data?.friends ?? []), [data]);
  const filtered = friends.filter((f) => matchesQuery(f, query));
  const here = filtered.filter((f) => f.presence !== "offline").slice(0, SHOWN);
  const offline = filtered.filter((f) => f.presence === "offline");
  // A search shows matching offline friends without the expander
  const searching = query.trim() !== "";
  const offlineShown = offlineOpen || searching ? offline.slice(0, SHOWN) : [];
  const requests = pending?.requests ?? 0;

  return (
    <Card
      title="Friends"
      actions={
        requests > 0 ? (
          <Link href="/friends?tab=requests" className={styles.watch}>
            {requests} request{requests === 1 ? "" : "s"}
          </Link>
        ) : undefined
      }
    >
      {friends.length > SHOWN && <SearchBox value={query} onChange={setQuery} />}
      {!data && !error ? (
        <p className={styles.empty}>Loading friends…</p>
      ) : error && !data ? (
        <p className={styles.error}>Could not load friends.</p>
      ) : friends.length === 0 ? (
        <p className={styles.empty}>
          None of your friends play here yet. <Link href="/friends">Find friends</Link>
        </p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>No friends match “{query.trim()}”.</p>
      ) : (
        <>
          {here.length > 0 ? (
            <ul className={styles.list}>
              {here.map((f) => (
                <FriendRow key={f.steamId} friend={f} actions={actions} joinable={joinable} />
              ))}
            </ul>
          ) : (
            !searching && <p className={styles.empty}>No friends online.</p>
          )}
          {offline.length > 0 && !searching && (
            <button
              type="button"
              className={styles.offlineToggle}
              aria-expanded={offlineOpen}
              aria-controls={offlineId}
              onClick={() => setOfflineOpen((v) => !v)}
            >
              <span>
                <span className="mono">{offline.length}</span> offline
              </span>
              <svg className={styles.chevron} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <ul id={offlineId} className={styles.list} hidden={offlineShown.length === 0}>
            {offlineShown.map((f) => (
              <FriendRow key={f.steamId} friend={f} actions={actions} />
            ))}
          </ul>
        </>
      )}
      {data && (
        <p className={styles.seeAll}>
          <Link href="/friends">{filtered.length > SHOWN ? `See all ${filtered.length} friends` : "See all friends"}</Link>
        </p>
      )}
    </Card>
  );
}
