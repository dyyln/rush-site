"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BRAND_NAME, type FriendRequest, type RecentPlayer } from "@rushsite/shared";
import { FriendRow, SteamOnlyRow } from "@/components/friends/FriendRow";
import { PresenceAvatar, friendError, matchesQuery, sortByPresence } from "@/components/friends/presence";
import { SearchBox } from "@/components/friends/SearchBox";
import { useJoinableModes } from "@/components/friends/useJoinQueue";
import { reloadFriends, reloadPending, useFriends } from "@/components/friends/store";
import { useFriendInvite } from "@/components/party/useFriendInvite";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SignInLink } from "@/components/ui/SignInLink";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { modeLabel } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import styles from "@/components/friends/friends.module.css";

// Accepts a SteamID64 or a steamcommunity.com/profiles link
function parseSteamId(input: string): string | null {
  const m = /(?:^|\/profiles\/)(\d{17})(?:\/|$)/.exec(input.trim());
  return m ? m[1]! : null;
}

const STEAM_PAGE = 50;

const byName = <T extends { displayName: string }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));

// A titled block. On desktop the list scrolls inside a max height and the header stays pinned
function Section({ id, title, count, actions, children }: { id: string; title: ReactNode; count?: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card tone="flat" padded={false} aria-labelledby={id}>
      <div className={styles.sectionScroll}>
        <div className={styles.sectionHead}>
          <h2 id={id}>{title}</h2>
          {count !== undefined && <span className={styles.count}>{count}</span>}
          {actions && <span className={styles.sectionHeadActions}>{actions}</span>}
        </div>
        {children}
      </div>
    </Card>
  );
}

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function FriendsView() {
  const { user, loading } = useSession();
  const { data, error } = useFriends(!!user);
  const recent = useAsync(() => (user ? api.friends.recent() : Promise.resolve([] as RecentPlayer[])), [user?.steamId]);
  const actions = useFriendInvite();
  const joinable = useJoinableModes({ enabled: !!user });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [steamOpen, setSteamOpen] = useState(false);
  const [steamShown, setSteamShown] = useState(STEAM_PAGE);
  useEffect(() => setSteamShown(STEAM_PAGE), [query]);
  const sortedFriends = useMemo(() => sortByPresence(data?.friends ?? []), [data]);
  const sortedSteam = useMemo(() => byName(data?.steamOnly ?? []), [data]);

  if (!loading && !user) {
    return (
      <div className="container page">
        <Card title="Sign in to see your friends" tone="raised">
          <p className="muted">Your Steam friends who play here are added for you when you sign in.</p>
          <SignInLink />
        </Card>
      </div>
    );
  }

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await fn();
      if (done) toast.push({ title: done, tone: "success" });
    } catch (e) {
      toast.push({ title: "Something went wrong", body: friendError(e), tone: "error" });
    }
    await Promise.all([reloadFriends(), reloadPending()]);
    setBusy(null);
  }

  async function add(steamId: string, name: string) {
    await act(`add:${steamId}`, () => api.friends.add(steamId), `Friend request sent to ${name}`);
    recent.reload();
  }

  async function submitAdd(e: FormEvent) {
    e.preventDefault();
    const id = parseSteamId(addValue);
    if (!id) {
      setAddError("Paste a SteamID64 or a steamcommunity.com/profiles link.");
      return;
    }
    setAddError(null);
    setBusy("add-form");
    try {
      await api.friends.add(id);
      toast.push({ title: "Friend request sent", tone: "success" });
      setAddValue("");
      await reloadFriends();
    } catch (err) {
      setAddError(friendError(err));
    }
    setBusy(null);
  }

  async function sync() {
    setSyncing(true);
    try {
      const r = await api.friends.sync();
      toast.push({
        title: r.steamListAvailable
          ? r.linked > 0
            ? `Added ${r.linked} Steam friend${r.linked === 1 ? "" : "s"}`
            : "Steam friends are up to date"
          : "Your Steam friends list is private",
        tone: r.steamListAvailable ? "success" : "info",
      });
      await reloadFriends();
    } catch (e) {
      toast.push({ title: "Could not refresh from Steam", body: friendError(e), tone: "error" });
    }
    setSyncing(false);
  }

  const match = <T extends { displayName: string; steamId: string }>(p: T) => matchesQuery(p, query);
  const searching = query.trim().length > 0;
  const friends = sortedFriends.filter(match);
  const incoming = (data?.incoming ?? []).filter((r) => match(r.from));
  const outgoing = (data?.outgoing ?? []).filter((r) => match(r.to));
  const steamOnly = sortedSteam.filter(match);
  const recentPlayers = (recent.data ?? []).filter(match);
  const steamExpanded = steamOpen || (searching && steamOnly.length > 0);
  const noMatch = <p className={styles.empty}>No one matches “{query.trim()}”.</p>;

  const requestRow = (r: FriendRequest, dir: "in" | "out") => {
    const other = dir === "in" ? r.from : r.to;
    return (
      <li key={r.id} className={styles.row}>
        <span className={styles.who}>
          <PresenceAvatar name={other.displayName} src={other.avatarUrl} presence="offline" />
          <span className={styles.names}>
            <Link href={`/profile/${other.steamId}`} className={styles.name}>
              {other.displayName}
            </Link>
            <span className={styles.presenceLine}>
              <span className={styles.presenceText}>
                {dir === "in" ? "Wants to be friends" : "Request sent"} · {ago(r.createdAt)}
              </span>
            </span>
          </span>
        </span>
        <span className={styles.actions}>
          {dir === "in" ? (
            <>
              <Button
                loading={busy === `accept:${r.id}`}
                disabled={!!busy}
                onClick={() => act(`accept:${r.id}`, () => api.friends.accept(r.id), `You and ${other.displayName} are now friends`)}
              >
                Accept
              </Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => act(`decline:${r.id}`, () => api.friends.decline(r.id))}>
                Decline
              </Button>
            </>
          ) : (
            <Button variant="ghost" loading={busy === `cancel:${r.id}`} disabled={!!busy} onClick={() => act(`cancel:${r.id}`, () => api.friends.cancel(r.id))}>
              Cancel
            </Button>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Friends</h1>
          <p>Invite friends to your party, challenge them, or watch their matches.</p>
        </div>
        <Button variant="secondary" onClick={sync} loading={syncing}>
          Refresh from Steam
        </Button>
      </header>

      <div className={styles.page}>
        <div className={styles.pageSearch}>
          <SearchBox value={query} onChange={setQuery} label="Search all friends" placeholder="Search friends, requests and players" />
        </div>

        {(incoming.length > 0 || outgoing.length > 0) && (
          <Section id="requests-heading" title="Requests" count={incoming.length + outgoing.length}>
            {incoming.length > 0 && <ul className={styles.list}>{incoming.map((r) => requestRow(r, "in"))}</ul>}
            {outgoing.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>Sent</h3>
                <ul className={styles.list}>{outgoing.map((r) => requestRow(r, "out"))}</ul>
              </>
            )}
          </Section>
        )}

        <Section id="friends-heading" title={`Friends on ${BRAND_NAME}`} count={data ? friends.length : undefined}>
          {!data && !error ? (
            <p className={styles.empty}>Loading friends…</p>
          ) : error && !data ? (
            <p className={styles.error}>Could not load friends.</p>
          ) : sortedFriends.length === 0 ? (
            <p className={styles.empty}>
              No friends yet. Steam friends who sign in here are added for you, or add players from your recent matches.
            </p>
          ) : friends.length === 0 ? (
            noMatch
          ) : (
            <ul className={styles.list}>
              {friends.map((f) => (
                <FriendRow key={f.steamId} friend={f} actions={actions} joinable={joinable} />
              ))}
            </ul>
          )}
        </Section>

        <Section id="recent-heading" title="Recent players" count={recent.status === "success" ? recentPlayers.length : undefined}>
          {recent.status === "loading" ? (
            <p className={styles.empty}>Loading…</p>
          ) : (recent.data ?? []).length === 0 ? (
            <p className={styles.empty}>Players from your last 20 matches show up here.</p>
          ) : recentPlayers.length === 0 ? (
            noMatch
          ) : (
            <ul className={styles.list}>
              {recentPlayers.map((p) => (
                <li key={p.steamId} className={styles.row}>
                  <span className={styles.who}>
                    <PresenceAvatar name={p.displayName} src={p.avatarUrl} presence="offline" />
                    <span className={styles.names}>
                      <Link href={`/profile/${p.steamId}`} className={styles.name}>
                        {p.displayName}
                      </Link>
                      <span className={styles.presenceLine}>
                        <span className={styles.presenceText}>
                          {modeLabel(p.mode)} · {ago(p.playedAt)}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className={styles.actions}>
                    <Button
                      variant="secondary"
                      disabled={p.requested || !!busy}
                      loading={busy === `add:${p.steamId}`}
                      onClick={() => add(p.steamId, p.displayName)}
                      aria-label={p.requested ? `Request sent to ${p.displayName}` : `Add ${p.displayName} as a friend`}
                    >
                      {p.requested ? "Requested" : "Add"}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {data && (
          <Card tone="flat" padded={false} aria-labelledby="steam-heading">
            <div className={styles.sectionScroll}>
              <div className={styles.sectionHead}>
                <h2 id="steam-heading" style={{ flex: 1 }}>
                  <button
                    type="button"
                    className={styles.disclosure}
                    aria-expanded={steamExpanded}
                    aria-controls="steam-list"
                    onClick={() => setSteamOpen((v) => !v)}
                    disabled={!data.steamListAvailable}
                  >
                    Steam friends not on {BRAND_NAME}
                    <span className={styles.count}>{data.steamListAvailable ? steamOnly.length : "private"}</span>
                    <svg className={styles.chevron} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </h2>
              </div>
              {!data.steamListAvailable ? (
                <p className={styles.empty}>Your Steam friends list is private, so we cannot suggest anyone.</p>
              ) : (
                steamExpanded && (
                  <div id="steam-list">
                    {sortedSteam.length === 0 ? (
                      <p className={styles.empty}>Every Steam friend who plays here is already on your list.</p>
                    ) : steamOnly.length === 0 ? (
                      noMatch
                    ) : (
                      <>
                        <p className={`muted ${styles.subtitle}`}>Send link copies your party link and opens the Steam chat.</p>
                        <ul className={styles.list}>
                          {steamOnly.slice(0, steamShown).map((f) => (
                            <SteamOnlyRow key={f.steamId} friend={f} actions={actions} />
                          ))}
                        </ul>
                        {steamOnly.length > steamShown && (
                          <Button variant="ghost" block onClick={() => setSteamShown((n) => n + STEAM_PAGE)}>
                            Show more ({steamOnly.length - steamShown} left)
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          </Card>
        )}

        <Section id="add-heading" title="Add a friend">
          <form className={styles.addForm} onSubmit={submitAdd} noValidate>
            <label htmlFor="add-friend" className="visually-hidden">
              SteamID64 or Steam profile link
            </label>
            <input
              id="add-friend"
              inputMode="text"
              autoComplete="off"
              placeholder="SteamID64 or profile link"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              aria-describedby="add-friend-hint"
              aria-invalid={!!addError || undefined}
            />
            <Button type="submit" loading={busy === "add-form"}>
              Send request
            </Button>
          </form>
          <p id="add-friend-hint" className={addError ? styles.error : styles.hint} role={addError ? "alert" : undefined}>
            {addError ?? "They need to have signed in here once."}
          </p>
        </Section>
      </div>
    </div>
  );
}
