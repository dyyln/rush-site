// Business metrics for the admin dashboards: acquisition, retention, engagement, queue health and cost.
// Everything is computed from the source tables on request. Days are UTC.
import {
  MODES,
  type ActivityKind,
  type BusinessOverview,
  type HostingCosts,
  type MetricPoint,
  type Mode,
  type QueueHealth,
  type RetentionView,
} from "@rushsite/shared"
import { sql, type SQL } from "drizzle-orm"
import type { Db } from "./types.js"

const DAY_MS = 86_400_000
const MONTH_DAYS = 30.4375

// A player-match: the player joined the server of a match that went live. One row per player per match
const PLAYED = sql`
  select mp.steam_id, mp.match_id, m.mode::text as mode, m.source::text as source, m.started_at,
    (m.started_at at time zone 'UTC')::date as day
  from match_players mp join matches m on m.id = mp.match_id
  where m.started_at is not null and mp.ever_connected`

// Signups. Leaves out bare rows an admin made to ban an id before it ever signed in
const SIGNUPS = sql`
  select u.steam_id, u.created_at from users u
  where not exists (select 1 from bans b where b.steam_id = u.steam_id and b.created_at < u.created_at + interval '1 minute')`

// Days a user counts as active. any adds signed in page loads, which are recorded from migration 0025 on
function activeDays(kind: ActivityKind): SQL {
  const played = sql`select distinct steam_id, day from (${PLAYED}) p`
  return kind === "played" ? played : sql`${played} union select steam_id, day from user_activity_days`
}

async function rows<T>(db: Db, q: SQL): Promise<T[]> {
  const r = (await db.execute(q)) as unknown
  // postgres-js returns the rows, PGlite wraps them
  return (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[]
}

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const dayMs = (key: string) => Date.parse(`${key}T00:00:00Z`)
const floorDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS
// Monday of the UTC week
const floorWeek = (ms: number) => {
  const d = floorDay(ms)
  return d - ((new Date(d).getUTCDay() + 6) % 7) * DAY_MS
}
const ratio = (n: number, d: number) => (d > 0 ? n / d : null)
const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places

export type Window = {
  days: number
  now: Date
  // Midnight of the first day
  from: Date
  // Midnight of today
  today: number
  dayKeys: string[]
}

export function windowOf(days: number, now: Date): Window {
  const today = floorDay(now.getTime())
  const from = today - (days - 1) * DAY_MS
  const dayKeys = Array.from({ length: days }, (_, i) => dayKey(from + i * DAY_MS))
  return { days, now, from: new Date(from), today, dayKeys }
}

const ts = (d: Date | number) => sql`${new Date(d).toISOString()}::timestamptz`
const dt = (ms: number) => sql`${dayKey(ms)}::date`

function series(w: Window, byDay: Map<string, number>, fill: number | null = 0): MetricPoint[] {
  return w.dayKeys.map((k) => ({ t: dayMs(k), v: byDay.get(k) ?? fill }))
}

function perModeSeries(w: Window, list: { mode: string; day: string; n: number }[], fill: number | null = 0): Record<Mode, MetricPoint[]> {
  return Object.fromEntries(
    MODES.map((mode) => [mode, series(w, new Map(list.filter((r) => r.mode === mode).map((r) => [r.day, Number(r.n)])), fill)]),
  ) as Record<Mode, MetricPoint[]>
}

async function signInTrackedSince(db: Db): Promise<string | null> {
  const [r] = await rows<{ day: string | null }>(db, sql`select to_char(min(day), 'YYYY-MM-DD') as day from user_activity_days`)
  return r?.day ?? null
}

// Distinct active players per day, over the trailing 7 and 30 days
async function activeSeries(db: Db, w: Window, kind: ActivityKind) {
  const list = await rows<{ day: string; dau: number; wau: number; mau: number }>(
    db,
    sql`
      with a as (select * from (${activeDays(kind)}) x where day >= ${dt(w.from.getTime() - 29 * DAY_MS)}),
      d as (select g::date as day from generate_series(${dt(w.from.getTime())}, ${dt(w.today)}, interval '1 day') g)
      select to_char(d.day, 'YYYY-MM-DD') as day,
        count(distinct a.steam_id) filter (where a.day = d.day)::int as dau,
        count(distinct a.steam_id) filter (where a.day > d.day - 7)::int as wau,
        count(distinct a.steam_id)::int as mau
      from d left join a on a.day between d.day - 29 and d.day
      group by d.day order by d.day`,
  )
  return list.map((r) => ({ day: r.day, dau: Number(r.dau), wau: Number(r.wau), mau: Number(r.mau) }))
}

async function acquisition(db: Db, w: Window): Promise<BusinessOverview["acquisition"]> {
  const weekFrom = floorWeek(w.from.getTime())
  const [totals] = await rows<{ total: number; before: number }>(
    db,
    sql`select count(*)::int as total, count(*) filter (where created_at < ${ts(w.from)})::int as before
      from (${SIGNUPS}) s where created_at <= ${ts(w.now)}`,
  )
  const perDay = await rows<{ day: string; n: number }>(
    db,
    sql`select to_char((created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, count(*)::int as n
      from (${SIGNUPS}) s where created_at >= ${ts(weekFrom)} and created_at <= ${ts(w.now)} group by 1`,
  )
  const byDay = new Map(perDay.map((r) => [r.day, Number(r.n)]))
  const newPerDay = series(w, byDay)
  let running = Number(totals?.before ?? 0)
  const cumulative = newPerDay.map((p) => ({ t: p.t, v: (running += p.v ?? 0) }))
  const weeks = new Map<number, number>()
  for (const [day, n] of byDay) {
    const wk = floorWeek(dayMs(day))
    weeks.set(wk, (weeks.get(wk) ?? 0) + n)
  }
  const newPerWeek: MetricPoint[] = []
  for (let t = weekFrom; t <= w.today; t += 7 * DAY_MS) newPerWeek.push({ t, v: weeks.get(t) ?? 0 })
  return {
    totalUsers: Number(totals?.total ?? 0),
    newUsers: newPerDay.reduce((n, p) => n + (p.v ?? 0), 0),
    newPerDay,
    newPerWeek,
    cumulative,
  }
}

async function engagement(db: Db, w: Window): Promise<BusinessOverview["engagement"]> {
  const inRange = sql`started_at >= ${ts(w.from)} and started_at <= ${ts(w.now)}`
  const [played, any, tracked, matchDays, playerDays, modeTotals, sources, parties, active] = await Promise.all([
    activeSeries(db, w, "played"),
    activeSeries(db, w, "any"),
    signInTrackedSince(db),
    rows<{ mode: string; day: string; n: number }>(
      db,
      sql`select mode::text as mode, to_char((started_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, count(*)::int as n
        from matches where ${inRange} group by 1, 2`,
    ),
    rows<{ day: string; n: number }>(
      db,
      sql`select to_char(day, 'YYYY-MM-DD') as day, count(*)::int as n from (${PLAYED}) p where ${inRange} group by 1`,
    ),
    rows<{ mode: string; pm: number; players: number }>(
      db,
      sql`select mode, count(*)::int as pm, count(distinct steam_id)::int as players from (${PLAYED}) p where ${inRange} group by 1`,
    ),
    rows<{ source: string; n: number }>(db, sql`select source::text as source, count(*)::int as n from matches where ${inRange} group by 1`),
    // Party size is the number of players in the match who came on the same party
    rows<{ party: number; total: number }>(
      db,
      sql`select count(*) filter (where size > 1)::int as party, count(*)::int as total from (
          select mp.ever_connected, count(*) over (partition by mp.match_id, mp.party_id) as size
          from match_players mp join matches m on m.id = mp.match_id
          where m.source = 'queue' and mp.party_id is not null and m.started_at is not null
            and m.started_at >= ${ts(w.from)} and m.started_at <= ${ts(w.now)}
        ) x where ever_connected`,
    ),
    rows<{ n: number }>(db, sql`select count(distinct steam_id)::int as n from (${PLAYED}) p where ${inRange}`),
  ])

  const dau = played.map((r) => ({ t: dayMs(r.day), v: r.dau }))
  const stick = played.map((r) => ({ t: dayMs(r.day), v: r.mau > 0 ? round(r.dau / r.mau, 4) : null }))
  const stickValues = stick.map((p) => p.v).filter((v): v is number => v !== null)
  const last = played.at(-1)
  const matchesTotal = matchDays.reduce((n, r) => n + Number(r.n), 0)
  const playerMatches = playerDays.reduce((n, r) => n + Number(r.n), 0)
  const activePlayers = Number(active[0]?.n ?? 0)
  const bySource = { queue: 0, tournament: 0, challenge: 0 }
  for (const s of sources) if (s.source in bySource) bySource[s.source as keyof typeof bySource] = Number(s.n)
  const party = parties[0]

  return {
    signInTrackedSince: tracked,
    dau,
    wau: played.map((r) => ({ t: dayMs(r.day), v: r.wau })),
    mau: played.map((r) => ({ t: dayMs(r.day), v: r.mau })),
    stickiness: stick,
    dauAny: any.map((r) => ({ t: dayMs(r.day), v: r.dau })),
    activePlayers,
    avgDau: played.length ? round(played.reduce((n, r) => n + r.dau, 0) / played.length, 1) : 0,
    wau7: last?.wau ?? 0,
    mau30: last?.mau ?? 0,
    avgStickiness: stickValues.length ? round(stickValues.reduce((a, b) => a + b, 0) / stickValues.length, 4) : null,
    matchesPerDay: perModeSeries(w, matchDays),
    playerMatchesPerDay: series(w, new Map(playerDays.map((r) => [r.day, Number(r.n)]))),
    matches: matchesTotal,
    playerMatches,
    matchesPerActivePlayer: ratio(playerMatches, activePlayers),
    partyShare: party ? ratio(Number(party.party), Number(party.total)) : null,
    bySource,
    perMode: MODES.map((mode) => {
      const t = modeTotals.find((r) => r.mode === mode)
      return {
        mode,
        matches: matchDays.filter((r) => r.mode === mode).reduce((n, r) => n + Number(r.n), 0),
        playerMatches: Number(t?.pm ?? 0),
        players: Number(t?.players ?? 0),
      }
    }),
  }
}

// Cups that started or were called off in the range. Upcoming cups are left out
async function cups(db: Db, w: Window): Promise<BusinessOverview["cups"]> {
  const inRange = sql`t.starts_at >= ${ts(w.from)} and t.starts_at <= ${ts(w.now)} and t.status <> 'open'`
  const [list, players] = await Promise.all([
    rows<{
      id: string
      name: string
      mode: string
      starts_at: string
      status: string
      max_entrants: number
      entries: number
      bracket: boolean
      no_shows: number
      forfeits: number
    }>(
      db,
      sql`select t.id, t.name, t.mode, to_char(t.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
          t.status, t.max_entrants,
          (select count(*) from tournament_entries e where e.tournament_id = t.id)::int as entries,
          exists (select 1 from brackets b where b.tournament_id = t.id) as bracket,
          -- Absent entries forfeit round one. A double forfeit loses both sides
          (select coalesce(sum(case when bm.resolution = 'double_forfeit' then 2 else 1 end), 0)
            from brackets b join bracket_matches bm on bm.bracket_id = b.id
            where b.tournament_id = t.id and bm.round = 1 and bm.resolution in ('forfeit', 'double_forfeit'))::int as no_shows,
          (select coalesce(sum(case when bm.resolution = 'double_forfeit' then 2 else 1 end), 0)
            from brackets b join bracket_matches bm on bm.bracket_id = b.id
            where b.tournament_id = t.id and bm.resolution in ('forfeit', 'double_forfeit'))::int as forfeits
        from tournaments t where ${inRange}
        order by t.starts_at desc`,
    ),
    rows<{ players: number; repeat: number }>(
      db,
      sql`select count(*)::int as players, count(*) filter (where n > 1)::int as repeat from (
          select p.steam_id, count(distinct t.id) as n
          from tournaments t join tournament_entries e on e.tournament_id = t.id cross join lateral unnest(e.steam_ids) as p(steam_id)
          where ${inRange} group by p.steam_id
        ) x`,
    ),
  ])
  const entries = list.reduce((n, c) => n + Number(c.entries), 0)
  const seats = list.reduce((n, c) => n + Number(c.max_entrants), 0)
  const bracketEntries = list.filter((c) => c.bracket).reduce((n, c) => n + Number(c.entries), 0)
  const p = players[0]
  return {
    cups: list.length,
    entries,
    players: Number(p?.players ?? 0),
    avgEntries: list.length ? round(entries / list.length, 1) : null,
    fillRate: ratio(entries, seats),
    noShowRate: ratio(
      list.reduce((n, c) => n + Number(c.no_shows), 0),
      bracketEntries,
    ),
    forfeitRate: ratio(
      list.reduce((n, c) => n + Number(c.forfeits), 0),
      bracketEntries,
    ),
    repeatShare: p ? ratio(Number(p.repeat), Number(p.players)) : null,
    recent: list.slice(0, 20).map((c) => ({
      id: c.id,
      name: c.name,
      mode: c.mode,
      startsAt: c.starts_at,
      status: c.status,
      entries: Number(c.entries),
      maxEntrants: Number(c.max_entrants),
      noShows: Number(c.no_shows),
    })),
  }
}

// Server time runs from allocation to release, counted on the day it started.
// Hetzner boxes are a fixed monthly cost, spread over the days in the range
async function cost(db: Db, w: Window, rates: HostingCosts, matches: number, playerMatches: number): Promise<BusinessOverview["cost"]> {
  const [hours, boxes] = await Promise.all([
    rows<{ day: string; driver: string; h: number }>(
      db,
      sql`select to_char((allocation_started_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, driver,
          sum(greatest(0, extract(epoch from (coalesce(server_released_at, ended_at, ${ts(w.now)}) - allocation_started_at))) / 3600)::float8 as h
        from matches
        where driver is not null and allocation_started_at >= ${ts(w.from)} and allocation_started_at <= ${ts(w.now)}
        group by 1, 2`,
    ),
    rows<{ n: number }>(db, sql`select count(*)::int as n from hosts where last_seen_at >= ${ts(w.from)}`),
  ])
  const of = (driver: string) => new Map(hours.filter((r) => r.driver === driver).map((r) => [r.day, round(Number(r.h))]))
  const sum = (driver: string) => hours.filter((r) => r.driver === driver).reduce((n, r) => n + Number(r.h), 0)
  const hetznerHours = sum("hetzner")
  const dathostHours = sum("dathost")
  const hetznerBoxes = Number(boxes[0]?.n ?? 0)
  const elapsedDays = (w.now.getTime() - w.from.getTime()) / DAY_MS
  const dathostEur = dathostHours * rates.dathostEurPerHour
  const hetznerEur = (hetznerBoxes * rates.hetznerBoxEurPerMonth * elapsedDays) / MONTH_DAYS
  const totalEur = dathostEur + hetznerEur
  const perMatch = ratio(totalEur, matches)
  const perPlayerMatch = ratio(totalEur, playerMatches)
  return {
    rates: { dathostEurPerHour: rates.dathostEurPerHour, hetznerBoxEurPerMonth: rates.hetznerBoxEurPerMonth },
    hetznerHours: series(w, of("hetzner")),
    dathostHours: series(w, of("dathost")),
    totals: {
      hetznerHours: round(hetznerHours),
      dathostHours: round(dathostHours),
      dathostEur: round(dathostEur),
      hetznerBoxes,
      hetznerEur: round(hetznerEur),
      totalEur: round(totalEur),
      perMatchEur: perMatch === null ? null : round(perMatch, 4),
      perPlayerMatchEur: perPlayerMatch === null ? null : round(perPlayerMatch, 4),
    },
    revenueEur: null,
  }
}

export async function businessOverview(db: Db, days: number, now: Date, rates: HostingCosts): Promise<BusinessOverview> {
  const w = windowOf(days, now)
  const [acq, eng, cup] = await Promise.all([acquisition(db, w), engagement(db, w), cups(db, w)])
  return {
    days,
    from: w.from.toISOString(),
    to: now.toISOString(),
    acquisition: acq,
    engagement: eng,
    cups: cup,
    cost: await cost(db, w, rates, eng.matches, eng.playerMatches),
  }
}

// Dn counts a signup as retained when active on the nth UTC day after the signup day.
// A day that has not finished yet is pending, not zero
export async function retentionView(db: Db, days: number, weeks: number, activity: ActivityKind, now: Date): Promise<RetentionView> {
  const w = windowOf(days, now)
  const weekFrom = floorWeek(w.today) - (weeks - 1) * 7 * DAY_MS
  const cohortFrom = Math.min(weekFrom, w.from.getTime())
  const acts = sql`
    with u as (select steam_id, (created_at at time zone 'UTC')::date as c from (${SIGNUPS}) s
      where created_at >= ${ts(cohortFrom)} and created_at <= ${ts(now)}),
    a as (select x.steam_id, x.day from (${activeDays(activity)}) x join u on u.steam_id = x.steam_id)`

  const [daily, weekly, sizes, tracked, returning] = await Promise.all([
    rows<{ cohort: string; size: number; d1: number; d7: number; d30: number }>(
      db,
      sql`${acts}
        select to_char(u.c, 'YYYY-MM-DD') as cohort, count(*)::int as size,
          count(*) filter (where exists (select 1 from a where a.steam_id = u.steam_id and a.day = u.c + 1))::int as d1,
          count(*) filter (where exists (select 1 from a where a.steam_id = u.steam_id and a.day = u.c + 7))::int as d7,
          count(*) filter (where exists (select 1 from a where a.steam_id = u.steam_id and a.day = u.c + 30))::int as d30
        from u where u.c >= ${dt(w.from.getTime())} group by u.c order by u.c desc`,
    ),
    rows<{ cohort: string; k: number; n: number }>(
      db,
      sql`${acts}
        select to_char(date_trunc('week', u.c)::date, 'YYYY-MM-DD') as cohort,
          ((a.day - date_trunc('week', u.c)::date) / 7)::int as k, count(distinct u.steam_id)::int as n
        from u join a on a.steam_id = u.steam_id and a.day >= u.c
        where u.c >= ${dt(weekFrom)} group by 1, 2`,
    ),
    rows<{ cohort: string; size: number }>(
      db,
      sql`${acts}
        select to_char(date_trunc('week', u.c)::date, 'YYYY-MM-DD') as cohort, count(*)::int as size
        from u where u.c >= ${dt(weekFrom)} group by 1`,
    ),
    signInTrackedSince(db),
    // New players by first match. A week counts once it ended inside the range, so every player shown is measured
    rows<{ players: number; w2: number; w2r: number; w4: number; w4r: number }>(
      db,
      sql`with p as (select distinct steam_id, day from (${PLAYED}) x),
        f as (select steam_id, min(day) as f from p group by steam_id),
        s as (select f.steam_id, f.f,
            exists (select 1 from p where p.steam_id = f.steam_id and p.day between f.f + 7 and f.f + 13) as r2,
            exists (select 1 from p where p.steam_id = f.steam_id and p.day between f.f + 21 and f.f + 27) as r4
          from f)
        select count(*) filter (where f >= ${dt(w.from.getTime())})::int as players,
          count(*) filter (where f + 13 >= ${dt(w.from.getTime())} and f + 13 < ${dt(w.today)})::int as w2,
          count(*) filter (where f + 13 >= ${dt(w.from.getTime())} and f + 13 < ${dt(w.today)} and r2)::int as w2r,
          count(*) filter (where f + 27 >= ${dt(w.from.getTime())} and f + 27 < ${dt(w.today)})::int as w4,
          count(*) filter (where f + 27 >= ${dt(w.from.getTime())} and f + 27 < ${dt(w.today)} and r4)::int as w4r
        from s`,
    ),
  ])

  // Day n is over once today is past it
  const done = (cohort: string, n: number) => dayMs(cohort) + n * DAY_MS < w.today
  const dailyOut = daily.map((r) => ({
    cohort: r.cohort,
    size: Number(r.size),
    d1: done(r.cohort, 1) ? Number(r.d1) : null,
    d7: done(r.cohort, 7) ? Number(r.d7) : null,
    d30: done(r.cohort, 30) ? Number(r.d30) : null,
  }))
  const weighted = (key: "d1" | "d7" | "d30") => {
    const measured = dailyOut.filter((r) => r[key] !== null)
    return ratio(
      measured.reduce((n, r) => n + (r[key] ?? 0), 0),
      measured.reduce((n, r) => n + r.size, 0),
    )
  }

  const weeklyOut = sizes
    .map((s) => {
      const start = dayMs(s.cohort)
      const cells = Array.from({ length: weeks }, (_, k) => {
        // Week k is over once its Sunday is before today
        if (start + (k * 7 + 6) * DAY_MS >= w.today) return null
        return Number(weekly.find((r) => r.cohort === s.cohort && Number(r.k) === k)?.n ?? 0)
      })
      return { cohort: s.cohort, size: Number(s.size), weeks: cells }
    })
    .sort((a, b) => b.cohort.localeCompare(a.cohort))

  const r = returning[0]
  const w2 = Number(r?.w2 ?? 0)
  const w4 = Number(r?.w4 ?? 0)
  return {
    days,
    from: w.from.toISOString(),
    to: now.toISOString(),
    activity,
    signInTrackedSince: tracked,
    daily: dailyOut,
    summary: { d1: weighted("d1"), d7: weighted("d7"), d30: weighted("d30") },
    weekly: weeklyOut,
    returning: {
      players: Number(r?.players ?? 0),
      weekTwo: { measured: w2, returned: Number(r?.w2r ?? 0), rate: ratio(Number(r?.w2r ?? 0), w2) },
      weekFour: { measured: w4, returned: Number(r?.w4r ?? 0), rate: ratio(Number(r?.w4r ?? 0), w4) },
    },
  }
}

// Peak players at the same moment per series and UTC day. Intervals become +n and -n events,
// a running sum gives the level, and a zero event at every midnight carries the level into each day
async function peaks(db: Db, w: Window): Promise<{ k: string; mode: string; day: string; peak: number }[]> {
  const from = ts(w.from)
  const now = ts(w.now)
  return rows(
    db,
    sql`
      with q as (
        select qt.modes, qt.enqueued_at as a, case when qt.status = 'waiting' then ${now} else qt.updated_at end as b,
          cardinality(qt.steam_ids) as n
        from queue_tickets qt
        where qt.enqueued_at < ${now} and (qt.status = 'waiting' or qt.updated_at > ${from})
      ),
      mt as (
        select m.mode::text as mode, m.created_at as c, m.started_at as st,
          case when m.status in ('finished', 'abandoned', 'cancelled') then coalesce(m.ended_at, m.created_at)
            else coalesce(m.ended_at, ${now}) end as e,
          (select count(*) from match_players mp where mp.match_id = m.id)::int as n
        from matches m
        where m.created_at < ${now} and (m.ended_at is null or m.ended_at > ${from})
      ),
      iv as (
        select k, 'all' as mode, a, b, n from q cross join (values ('queue'), ('loop')) kk(k)
        union all
        select k, x.mode::text, a, b, n from q cross join lateral unnest(q.modes) as x(mode) cross join (values ('queue'), ('loop')) kk(k)
        union all
        select 'play', 'all', st, e, n from mt where st is not null
        union all
        select 'play', mode, st, e, n from mt where st is not null
        union all
        select 'loop', 'all', c, e, n from mt
        union all
        select 'loop', mode, c, e, n from mt
      ),
      live as (select * from iv where b > a and b > ${from}),
      ev as (
        select k, mode, greatest(a, ${from}) as t, n as d from live
        union all
        select k, mode, least(b, ${now}), -n from live
        union all
        select keys.k, keys.mode, (g::timestamp at time zone 'UTC'), 0
        from (select distinct k, mode from live) keys
          cross join generate_series(${dt(w.from.getTime())}, ${dt(w.today)}, interval '1 day') g
      ),
      run as (select k, mode, t, sum(d) over (partition by k, mode order by t, d rows unbounded preceding) as lvl from ev)
      select k, mode, to_char((t at time zone 'UTC')::date, 'YYYY-MM-DD') as day, max(lvl)::int as peak
      from run where t >= ${from} and t <= ${now}
      group by 1, 2, 3`,
  )
}

export async function queueHealth(db: Db, days: number, now: Date): Promise<QueueHealth> {
  const w = windowOf(days, now)
  const from = ts(w.from)
  const until = ts(now)
  // Wait is from joining the queue to the first match found for the ticket, weighted per ticket not per player
  const firsts = sql`
    with f as (
      select mp.ticket_id, min(m.created_at) as found, (array_agg(m.mode::text order by m.created_at))[1] as mode
      from match_players mp join matches m on m.id = mp.match_id
      where mp.ticket_id is not null and m.source = 'queue'
      group by mp.ticket_id
    ),
    wt as (
      select f.mode, f.found, qt.enqueued_at, greatest(0, extract(epoch from (f.found - qt.enqueued_at)))::float8 as w
      from f join queue_tickets qt on qt.id = f.ticket_id
      where f.found >= ${from} and f.found <= ${until}
    )`
  const [waits, waitDays, waitHours, exits, accept, forfeits, peakRows, heat] = await Promise.all([
    rows<{ mode: string; tickets: number; med: number | null; p90: number | null }>(
      db,
      sql`${firsts}
        select mode, count(*)::int as tickets,
          percentile_cont(0.5) within group (order by w)::float8 as med,
          percentile_cont(0.9) within group (order by w)::float8 as p90
        from wt group by mode`,
    ),
    rows<{ mode: string; day: string; n: number }>(
      db,
      sql`${firsts}
        select mode, to_char((found at time zone 'UTC')::date, 'YYYY-MM-DD') as day,
          percentile_cont(0.5) within group (order by w)::float8 as n
        from wt group by 1, 2`,
    ),
    rows<{ mode: string; h: number; n: number }>(
      db,
      sql`${firsts}
        select mode, extract(hour from enqueued_at at time zone 'UTC')::int as h,
          percentile_cont(0.5) within group (order by w)::float8 as n
        from wt group by 1, 2`,
    ),
    // A ticket left when its party walked away before any match was found. Leaving after a failed accept counts as matched
    rows<{ mode: string; tickets: number; matched: number; left: number }>(
      db,
      sql`select x.mode::text as mode, count(*)::int as tickets,
          count(*) filter (where exists (select 1 from match_players mp where mp.ticket_id = qt.id))::int as matched,
          count(*) filter (where qt.status = 'cancelled' and qt.cancel_reason = 'left'
            and not exists (select 1 from match_players mp where mp.ticket_id = qt.id))::int as left
        from queue_tickets qt cross join lateral unnest(qt.modes) as x(mode)
        where qt.enqueued_at >= ${from} and qt.enqueued_at <= ${until}
        group by 1`,
    ),
    // Matches with an accept step that has finished. A player who never answered a window someone else declined is neither
    rows<{ matches: number; passed: number; prompts: number; accepted: number; declined: number; timed_out: number }>(
      db,
      sql`select count(distinct m.id)::int as matches,
          count(distinct m.id) filter (where m.cancel_reason is null or m.cancel_reason not like 'accept\\_%')::int as passed,
          count(*)::int as prompts,
          count(*) filter (where mp.accepted and not mp.declined)::int as accepted,
          count(*) filter (where mp.declined)::int as declined,
          count(*) filter (where not mp.accepted and not mp.declined and m.cancel_reason = 'accept_timeout')::int as timed_out
        from matches m join match_players mp on mp.match_id = m.id
        where m.accept_deadline is not null and m.status <> 'accepting'
          and m.created_at >= ${from} and m.created_at <= ${until}`,
    ),
    // Only penalised players carry the abandoned mark. Never connected is a no-show, left mid-match is an abandon
    rows<{ slots: number; no_shows: number; abandons: number }>(
      db,
      sql`select count(*)::int as slots,
          count(*) filter (where mp.abandoned and not mp.ever_connected)::int as no_shows,
          count(*) filter (where mp.abandoned and mp.ever_connected)::int as abandons
        from matches m join match_players mp on mp.match_id = m.id
        where m.ready_at is not null and m.created_at >= ${from} and m.created_at <= ${until}`,
    ),
    peaks(db, w),
    rows<{ dow: number; h: number; n: number }>(
      db,
      sql`select (extract(isodow from started_at at time zone 'UTC')::int - 1) as dow,
          extract(hour from started_at at time zone 'UTC')::int as h, count(*)::int as n
        from (${PLAYED}) p where started_at >= ${from} and started_at <= ${until} group by 1, 2`,
    ),
  ])

  const peakSeries = (k: string, mode: string) =>
    series(w, new Map(peakRows.filter((r) => r.k === k && r.mode === mode).map((r) => [r.day, Number(r.peak)])))
  const loopByMode = Object.fromEntries(MODES.map((m) => [m, peakSeries("loop", m)])) as Record<Mode, MetricPoint[]>
  const maxOf = (s: MetricPoint[]) => s.reduce((n, p) => Math.max(n, p.v ?? 0), 0)
  const loop = peakSeries("loop", "all")
  const a = accept[0]
  const f = forfeits[0]
  const prompts = Number(a?.prompts ?? 0)
  const slots = Number(f?.slots ?? 0)
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const r of heat) heatmap[Number(r.dow)]![Number(r.h)] = Number(r.n)

  return {
    days,
    from: w.from.toISOString(),
    to: now.toISOString(),
    waits: MODES.map((mode) => {
      const r = waits.find((x) => x.mode === mode)
      return {
        mode,
        tickets: Number(r?.tickets ?? 0),
        medianSec: r?.med == null ? null : Math.round(Number(r.med)),
        p90Sec: r?.p90 == null ? null : Math.round(Number(r.p90)),
      }
    }),
    waitPerDay: perModeSeries(
      w,
      waitDays.map((r) => ({ ...r, n: Math.round(Number(r.n)) })),
      null,
    ),
    waitByHour: Object.fromEntries(
      MODES.map((mode) => {
        const hours: (number | null)[] = Array.from({ length: 24 }, () => null)
        for (const r of waitHours) if (r.mode === mode) hours[Number(r.h)] = Math.round(Number(r.n))
        return [mode, hours]
      }),
    ) as Record<Mode, (number | null)[]>,
    exits: MODES.map((mode) => {
      const r = exits.find((x) => x.mode === mode)
      const tickets = Number(r?.tickets ?? 0)
      const left = Number(r?.left ?? 0)
      return { mode, tickets, matched: Number(r?.matched ?? 0), left, leftRate: ratio(left, tickets) }
    }),
    accept: {
      matches: Number(a?.matches ?? 0),
      passed: Number(a?.passed ?? 0),
      prompts,
      accepted: Number(a?.accepted ?? 0),
      declined: Number(a?.declined ?? 0),
      timedOut: Number(a?.timed_out ?? 0),
      acceptRate: ratio(Number(a?.accepted ?? 0), prompts),
      declineRate: ratio(Number(a?.declined ?? 0), prompts),
      timeoutRate: ratio(Number(a?.timed_out ?? 0), prompts),
    },
    forfeits: {
      slots,
      noShows: Number(f?.no_shows ?? 0),
      abandons: Number(f?.abandons ?? 0),
      noShowRate: ratio(Number(f?.no_shows ?? 0), slots),
      abandonRate: ratio(Number(f?.abandons ?? 0), slots),
    },
    peaks: {
      queued: peakSeries("queue", "all"),
      playing: peakSeries("play", "all"),
      loop,
      loopByMode,
      maxLoop: maxOf(loop),
      maxLoopByMode: Object.fromEntries(MODES.map((m) => [m, maxOf(loopByMode[m])])) as Record<Mode, number>,
    },
    heatmap,
  }
}
