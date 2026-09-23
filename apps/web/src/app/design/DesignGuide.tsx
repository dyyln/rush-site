"use client";

import { useState, type ReactNode } from "react";
import { AIM_MAPS, TIERS, type QueueStatusPayload, type VetoState } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { BracketView } from "@/components/ui/BracketView";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { MapCard } from "@/components/ui/MapCard";
import { Modal } from "@/components/ui/Modal";
import { PartyPanel } from "@/components/ui/PartyPanel";
import { PartySize } from "@/components/ui/PartySize";
import { QueueStatus } from "@/components/ui/QueueStatus";
import { RatingSparkline } from "@/components/ui/RatingSparkline";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { Table, type Column } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { TierChip } from "@/components/ui/TierChip";
import { Throbber } from "@/components/ui/Throbber";
import { Timer } from "@/components/ui/Timer";
import { Toast, useToast } from "@/components/ui/Toast";
import { VetoBoard } from "@/components/ui/VetoBoard";
import { MOCK_ME, MOCK_NOW, MOCK_TOURNAMENT_IDS, mockLeaderboard, mockParty, mockProfile, mockSteamId, mockTournamentDetail } from "@/lib/mock";
import type { LeaderboardRow } from "@/lib/types";
import styles from "./design.module.css";

const COLORS = [
  ["--color-bg", "Background"],
  ["--color-surface-1", "Surface 1"],
  ["--color-surface-2", "Surface 2"],
  ["--color-surface-3", "Surface 3"],
  ["--color-border", "Border"],
  ["--color-border-strong", "Border strong"],
  ["--color-text", "Text"],
  ["--color-text-muted", "Muted text"],
  ["--color-accent", "Accent"],
  ["--color-accent-hover", "Accent hover"],
  ["--color-win", "Win"],
  ["--color-loss", "Loss"],
  ["--color-info", "Trust and info"],
  ["--color-credits", "Credits"],
];

const SECTIONS = [
  "Tokens",
  "Button",
  "Badge",
  "Tier chip",
  "Avatar",
  "Party size",
  "Card",
  "Stat tile",
  "Input",
  "Select",
  "Tabs",
  "Table",
  "Timer",
  "Throbber",
  "Rating sparkline",
  "Toast",
  "Modal",
  "Map card",
  "Veto board",
  "Party panel",
  "Queue status",
  "Bracket view",
];

const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section id={slug(title)} className={styles.section} aria-labelledby={`h-${slug(title)}`}>
      <h2 id={`h-${slug(title)}`} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.specimen}>
      <p className={styles.specimenLabel}>{label}</p>
      <div className={styles.specimenBody}>{children}</div>
    </div>
  );
}

function vetoFixture(stage: "mine" | "theirs" | "done"): VetoState {
  const pool = AIM_MAPS.map((m) => m.id);
  const steps = pool.slice(1).map((_, i) => ({ action: "ban" as const, team: (i % 2) as 0 | 1 }));
  const teams: VetoState["teams"] = [
    { id: "team_a", steamIds: [MOCK_ME.steamId, mockSteamId(4)] },
    { id: "team_b", steamIds: [mockSteamId(20), mockSteamId(21)] },
  ];
  const mk = (n: number) =>
    pool.slice(0, n).map((mapId, i) => ({
      step: i,
      action: "ban" as const,
      team: (i % 2) as 0 | 1,
      mapId,
      votes: {},
      tieBroken: i === 1,
      noVotes: false,
    }));
  if (stage === "done") {
    return { pool, teams, steps, stepIndex: 5, available: [pool[5]!], votes: {}, history: mk(5), done: true, maps: [pool[5]!] };
  }
  const n = stage === "mine" ? 2 : 1;
  return {
    pool,
    teams,
    steps,
    stepIndex: n,
    available: pool.slice(n),
    votes: stage === "mine" ? { [mockSteamId(4)]: pool[3]! } : { [mockSteamId(20)]: pool[4]! },
    history: mk(n),
    done: false,
    maps: [],
  };
}

const QUEUE_ALL: QueueStatusPayload = {
  state: "queued",
  partyId: null,
  cooldownUntil: null,
  modes: [
    { mode: "aim1v1", queuedAt: MOCK_NOW - 38_000, waitSec: 38, estimatedSec: 45, ratingWindow: 200, playersInQueue: 23 },
    { mode: "aim2v2", queuedAt: MOCK_NOW - 38_000, waitSec: 38, estimatedSec: 90, ratingWindow: 200, playersInQueue: 14 },
    { mode: "rush3v3", queuedAt: MOCK_NOW - 312_000, waitSec: 312, estimatedSec: 70, ratingWindow: null, playersInQueue: 41 },
  ],
};

const lbColumns: Column<LeaderboardRow>[] = [
  { key: "rank", header: "#", cell: (r) => r.rank, numeric: true, width: "48px" },
  { key: "player", header: "Player", cell: (r) => r.displayName },
  { key: "rating", header: "Rating", cell: (r) => <TierChip tier={r.tier} rating={r.rating} size="sm" />, align: "right" },
];

export function DesignGuide() {
  const toast = useToast();
  const [tab, setTab] = useState<"aim1v1" | "aim2v2" | "rush3v3">("aim1v1");
  const [modal, setModal] = useState<null | "info" | "blocking">(null);
  const [voted, setVoted] = useState<string | null>(null);
  const profile = mockProfile(MOCK_ME.steamId);
  const history = profile.modes[0]!.history;
  const running = mockTournamentDetail(MOCK_TOURNAMENT_IDS[1]!)!;
  const completed = mockTournamentDetail(MOCK_TOURNAMENT_IDS[3]!)!;
  const lb = mockLeaderboard("aim1v1", 0, 5).rows;

  return (
    <div className={`container page ${styles.layout}`}>
      <header className="page-header">
        <div>
          <h1>Design system</h1>
          <p>Every component in every state. Tokens live in src/styles/tokens.css.</p>
        </div>
      </header>

      <nav aria-label="Components" className={styles.toc}>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s}>
              <a href={`#${slug(s)}`}>{s}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className={styles.content}>
        <Section title="Tokens">
          <ul className={styles.swatches}>
            {COLORS.map(([v, name]) => (
              <li key={v} className={styles.swatch}>
                <span className={styles.chip} style={{ background: `var(${v})` }} />
                <span>
                  <span className={styles.swatchName}>{name}</span>
                  <code className="mono muted">{v}</code>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.type}>
            <p className={styles.display}>Chakra Petch display</p>
            <p>IBM Plex Sans body. Queue for short matches and climb a rating ladder per mode.</p>
            <p className="mono">IBM Plex Mono 1729 aim_redline 16:11</p>
          </div>
        </Section>

        <Section title="Button">
          <Specimen label="Variants">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </Specimen>
          <Specimen label="States">
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
            <Button size="lg">Large</Button>
            <ButtonLink href="/play" variant="secondary">
              Link button
            </ButtonLink>
          </Specimen>
          <Specimen label="Block">
            <Button block size="lg">
              Find match
            </Button>
          </Specimen>
        </Section>

        <Section title="Badge">
          <Specimen label="Tones">
            <Badge>Neutral</Badge>
            <Badge tone="accent">Leader</Badge>
            <Badge tone="win">Win</Badge>
            <Badge tone="loss">Loss</Badge>
            <Badge tone="info">Verified</Badge>
            <Badge tone="warn">Cooldown</Badge>
          </Specimen>
        </Section>

        <Section title="Tier chip">
          <Specimen label="Every tier">
            {TIERS.map((t) => (
              <TierChip key={t.id} tier={t.id} />
            ))}
          </Specimen>
          <Specimen label="With rating">
            <TierChip rating={1729} />
            <TierChip rating={2311} size="sm" />
            <TierChip rating={940} size="sm" />
            <TierChip unranked />
            <TierChip unranked size="sm" />
          </Specimen>
        </Section>

        <Section title="Avatar">
          <Specimen label="Sizes and status">
            <Avatar name="vexa" size="sm" />
            <Avatar name="kolt" status="online" />
            <Avatar name="mirren" status="ready" />
            <Avatar name="ashgrove" status="away" />
            <Avatar name="tessler" size="lg" />
          </Specimen>
        </Section>

        <Section title="Party size">
          <Specimen label="Team sizes">
            <PartySize count={1} label="1 vs 1" />
            <PartySize count={2} label="2 vs 2" />
            <PartySize count={3} label="3 vs 3" />
          </Specimen>
          <Specimen label="Party of 2 out of 3, and party of 2 on a 1v1 card">
            <PartySize count={2} capacity={3} label="2 of 3 players" />
            <PartySize count={1} overflow={1} label="1 vs 1. Party of 2 is too big" />
          </Specimen>
        </Section>

        <Section title="Card">
          <div className={styles.cards}>
            <Card title="Default">Surface 1 with a border.</Card>
            <Card title="Raised" tone="raised" eyebrow="Eyebrow">
              Surface 2 for nested emphasis.
            </Card>
            <Card title="Accent" tone="accent" actions={<Button variant="ghost">Action</Button>}>
              Accent border for the active item.
            </Card>
          </div>
        </Section>

        <Section title="Stat tile">
          <div className={styles.tiles}>
            <StatTile label="Rating" value="1729" sub="+17 last match" trend="up" />
            <StatTile label="Win rate" value="54%" sub="212 matches" />
            <StatTile label="Headshot" value="48%" sub="-2% this week" trend="down" />
            <StatTile label="K/D" value="1.21" />
          </div>
        </Section>

        <Section title="Input">
          <div className={styles.fields}>
            <Input label="Default" placeholder="Invite code" />
            <Input label="With hint" hint="Paste the code from your friend's link" defaultValue="K7QX-94TD" />
            <Input label="Error" error="That invite has expired" defaultValue="AAAA-0000" />
            <Input label="Disabled" disabled defaultValue="Locked while queued" />
            <Input label="Read only" readOnly defaultValue="connect 203.0.113.24:27017" className="mono" />
          </div>
        </Section>

        <Section title="Select">
          <div className={styles.fields}>
            <Select
              label="Mode"
              options={[
                { value: "aim1v1", label: "1v1 Aim" },
                { value: "aim2v2", label: "2v2 Aim" },
                { value: "rush3v3", label: "3v3 Rush" },
              ]}
            />
            <Select label="Error" error="Pick a mode" options={[{ value: "", label: "Choose" }]} />
            <Select label="Disabled" disabled options={[{ value: "eu", label: "EU" }]} />
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs
            label="Mode"
            value={tab}
            onChange={setTab}
            items={[
              { key: "aim1v1", label: "1v1 Aim" },
              { key: "aim2v2", label: "2v2 Aim" },
              { key: "rush3v3", label: "3v3 Rush", disabled: false },
            ]}
          >
            <p className="muted">Panel for {tab}. Arrow keys move between tabs.</p>
          </Tabs>
        </Section>

        <Section title="Table">
          <Specimen label="Rows with highlight">
            <div className={styles.full}>
              <Table caption="Leaderboard sample" columns={lbColumns} rows={lb} rowKey={(r) => r.steamId} highlight={(r) => r.rank === 3} />
            </div>
          </Specimen>
          <Specimen label="Loading">
            <div className={styles.full}>
              <Table caption="Loading" columns={lbColumns} rows={[]} rowKey={(r) => r.steamId} loading />
            </div>
          </Specimen>
          <Specimen label="Empty">
            <div className={styles.full}>
              <Table caption="Empty" columns={lbColumns} rows={[]} rowKey={(r) => r.steamId} empty="No placed players yet." />
            </div>
          </Specimen>
        </Section>

        <Section title="Timer">
          <Specimen label="Count up, count down, urgent">
            <Timer label="In queue" frozenSec={83} />
            <Timer label="Step" frozenSec={14} totalSec={20} />
            <Timer label="Step" frozenSec={4} totalSec={20} />
          </Specimen>
          <Specimen label="Ring">
            <Timer frozenSec={16} totalSec={20} size="lg" label="Accept" />
            <Timer frozenSec={3} totalSec={20} size="lg" label="Accept" />
          </Specimen>
        </Section>

        <Section title="Throbber">
          <Specimen label="Searching indicator, static under reduced motion">
            <Throbber label="Searching" />
            <span className="row">
              <Throbber /> 1v1 Aim <span className="muted">(23 in queue)</span>
            </span>
          </Specimen>
        </Section>

        <Section title="Rating sparkline">
          <Specimen label="Compact">
            <div className={styles.spark}>
              <RatingSparkline points={history} label="1v1 Aim rating" />
            </div>
            <div className={styles.spark}>
              <RatingSparkline points={[...history].reverse().map((p, i) => ({ ...p, ts: history[i]!.ts }))} label="Falling rating" />
            </div>
          </Specimen>
          <Specimen label="Detailed with tier lines">
            <div className={styles.full}>
              <RatingSparkline points={history} label="Rating history" width={640} height={160} detailed />
            </div>
          </Specimen>
          <Specimen label="Not enough data">
            <RatingSparkline points={[]} label="Rating history" />
          </Specimen>
        </Section>

        <Section title="Toast">
          <Specimen label="Static">
            <div className={styles.stack}>
              <Toast title="Party joined" body="You are in vexa's party." tone="success" onDismiss={() => {}} />
              <Toast title="Match found" body="Accept within 20 seconds." tone="info" />
              <Toast title="Could not join queue" body="You are on cooldown for 1:00." tone="error" onDismiss={() => {}} />
            </div>
          </Specimen>
          <Specimen label="Live">
            <Button variant="secondary" onClick={() => toast.push({ title: "Party created", tone: "success" })}>
              Push success
            </Button>
            <Button variant="secondary" onClick={() => toast.push({ title: "Server not ready", body: "Retrying.", tone: "error" })}>
              Push error
            </Button>
          </Specimen>
        </Section>

        <Section title="Modal">
          <Specimen label="Open">
            <Button variant="secondary" onClick={() => setModal("info")}>
              Dismissable
            </Button>
            <Button variant="secondary" onClick={() => setModal("blocking")}>
              Blocking
            </Button>
          </Specimen>
          <Modal
            open={modal === "info"}
            title="Leave party"
            onClose={() => setModal(null)}
            footer={
              <>
                <Button variant="ghost" onClick={() => setModal(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => setModal(null)}>
                  Leave
                </Button>
              </>
            }
          >
            <p>You will leave the queue too.</p>
          </Modal>
          <Modal
            open={modal === "blocking"}
            title="Match found"
            blocking
            footer={
              <>
                <Button variant="ghost" onClick={() => setModal(null)}>
                  Decline
                </Button>
                <Button onClick={() => setModal(null)}>Accept</Button>
              </>
            }
          >
            <p>Escape and the backdrop do nothing. The player must choose.</p>
          </Modal>
        </Section>

        <Section title="Map card">
          <ul className={styles.maps}>
            <li>
              <MapCard mapId="aim_map" name="aim_map" onSelect={() => {}} />
            </li>
            <li>
              <MapCard mapId="aim_redline" name="aim_redline" voted votes={2} onSelect={() => {}} />
            </li>
            <li>
              <MapCard mapId="aim_usp" name="aim_usp" votes={1} onSelect={() => {}} disabled />
            </li>
            <li>
              <MapCard mapId="aim_deagle7k" name="aim_deagle7k" state="banned" note="By opponents" />
            </li>
            <li>
              <MapCard mapId="awp_india" name="awp_india" state="picked" note="By your team" />
            </li>
            <li>
              <MapCard mapId="aim_ag_texture2" name="aim_ag_texture2" state="decider" />
            </li>
          </ul>
        </Section>

        <Section title="Veto board">
          <Specimen label="Your turn, interactive">
            <div className={styles.full}>
              <VetoBoard
                mode="aim2v2"
                state={{ ...vetoFixture("mine"), votes: voted ? { ...vetoFixture("mine").votes, [MOCK_ME.steamId]: voted } : vetoFixture("mine").votes }}
                mySteamId={MOCK_ME.steamId}
                stepDeadline={MOCK_NOW}
                frozenSec={14}
                onVote={setVoted}
                names={{ [mockSteamId(4)]: "nollie" }}
              />
            </div>
          </Specimen>
          <Specimen label="Opponents' turn">
            <div className={styles.full}>
              <VetoBoard mode="aim2v2" state={vetoFixture("theirs")} mySteamId={MOCK_ME.steamId} stepDeadline={MOCK_NOW} frozenSec={9} />
            </div>
          </Specimen>
          <Specimen label="Done">
            <div className={styles.full}>
              <VetoBoard mode="aim2v2" state={vetoFixture("done")} mySteamId={MOCK_ME.steamId} stepDeadline={null} />
            </div>
          </Specimen>
        </Section>

        <Section title="Party panel">
          <div className={styles.cards}>
            <PartyPanel party={null} mySteamId={MOCK_ME.steamId} onCreate={() => {}} />
            <PartyPanel
              party={mockParty(2)}
              mySteamId={MOCK_ME.steamId}
              inviteUrl="https://example.invalid/invite/K7QX-94TD"
              onLeave={() => {}}
              onKick={() => {}}
            />
            <PartyPanel party={mockParty(3)} mySteamId={MOCK_ME.steamId} inviteUrl="https://example.invalid/invite/K7QX-94TD" onLeave={() => {}} locked />
          </div>
        </Section>

        <Section title="Queue status">
          <Specimen label="Idle, next to the button">
            <Button size="lg">Start queue</Button>
            <QueueStatus status={{ state: "idle", partyId: null, modes: [], cooldownUntil: null }} />
          </Specimen>
          <Specimen label="Queued">
            <Button size="lg" variant="danger">
              Stop queue
            </Button>
            <QueueStatus status={QUEUE_ALL} frozen />
          </Specimen>
          <Specimen label="Cooldown">
            <Button size="lg" disabled>
              Start queue
            </Button>
            <QueueStatus status={{ state: "cooldown", partyId: null, modes: [], cooldownUntil: MOCK_NOW + 60_000 }} frozen />
          </Specimen>
          <Specimen label="Queued, connection lost">
            <Button size="lg" variant="danger">
              Stop queue
            </Button>
            <QueueStatus status={QUEUE_ALL} connection="closed" frozen />
          </Specimen>
        </Section>

        <Section title="Bracket view">
          <Specimen label="Running, with live match">
            <div className={styles.full}>
              {running.bracket && <BracketView bracket={running.bracket} entries={running.entries} highlightEntryId={running.entries[4]?.id} />}
            </div>
          </Specimen>
          <Specimen label="Completed with byes">
            <div className={styles.full}>
              {completed.bracket && <BracketView bracket={completed.bracket} entries={completed.entries} />}
            </div>
          </Specimen>
        </Section>
      </div>
    </div>
  );
}
