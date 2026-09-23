"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFriendInvite, type InviteSource } from "@/components/party/useFriendInvite";
import { Card } from "@/components/ui/Card";
import { FriendRow } from "./FriendRow";
import { matchesQuery, sortByPresence } from "./presence";
import { SearchBox } from "./SearchBox";
import { usePending, useFriends } from "./store";
import styles from "./friends.module.css";

const SHOWN = 8;

// Friends who play here, under the party panel on /play. Steam-only friends live on /friends
export function FriendsCard(invite: Partial<InviteSource>) {
  const { data, error } = useFriends();
  const { data: pending } = usePending();
  const actions = useFriendInvite(invite);
  const [query, setQuery] = useState("");

  const friends = useMemo(() => sortByPresence(data?.friends ?? []), [data]);
  const filtered = friends.filter((f) => matchesQuery(f, query));
  const shown = filtered.slice(0, SHOWN);
  const requests = pending?.requests ?? 0;

  return (
    <Card
      title="Friends"
      actions={
        requests > 0 ? (
          <Link href="/friends" className={styles.watch}>
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
        <ul className={styles.list}>
          {shown.map((f) => (
            <FriendRow key={f.steamId} friend={f} actions={actions} />
          ))}
        </ul>
      )}
      {data && (
        <p className={styles.seeAll}>
          <Link href="/friends">
            {filtered.length > SHOWN ? `See all ${filtered.length} friends` : "See all friends"}
          </Link>
        </p>
      )}
    </Card>
  );
}
