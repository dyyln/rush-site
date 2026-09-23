import { Fragment, type ReactNode } from "react";
import type { Mode, VetoState } from "@rushsite/shared";
import { mapName } from "@/lib/modes";
import styles from "./VetoSummary.module.css";

type Entry = VetoState["history"][number];

function List({ mode, entries }: { mode: Mode; entries: Entry[] }) {
  return (
    <>
      {entries.map((e, i) => (
        <Fragment key={e.mapId}>
          {i > 0 && ", "}
          <strong className="mono">{mapName(mode, e.mapId)}</strong>
          {e.noVotes && <span className={styles.auto}>auto</span>}
        </Fragment>
      ))}
    </>
  );
}

// One line after the veto. "You banned X · They banned Y · Playing Z"
export function VetoSummary({ mode, state, mySteamId }: { mode: Mode; state: VetoState; mySteamId: string }) {
  if (!state.done) return null;
  const myTeam = state.teams[0].steamIds.includes(mySteamId) ? 0 : 1;
  const bans = state.history.filter((h) => h.action === "ban");
  const ours = bans.filter((h) => h.team === myTeam);
  const theirs = bans.filter((h) => h.team !== myTeam);
  const parts: ReactNode[] = [];
  if (ours.length) parts.push(<>You banned <List mode={mode} entries={ours} /></>);
  if (theirs.length) parts.push(<>They banned <List mode={mode} entries={theirs} /></>);
  if (state.maps.length) parts.push(<>Playing <strong className="mono">{state.maps.map((m) => mapName(mode, m)).join(", ")}</strong></>);
  if (parts.length === 0) return null;
  return (
    <p className={styles.summary}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {p}
        </Fragment>
      ))}
    </p>
  );
}
