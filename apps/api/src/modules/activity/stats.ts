import { desc, eq, sql, type SQL } from "drizzle-orm"
import type { Db } from "../../db/client.js"
import { activityEvents, userActivity } from "./schema.js"

const DAY_MS = 86_400_000
// Players not seen for this long count as gone
export const INACTIVE_DAYS = 7
const COHORT_WEEKS = 8
const SERIES_DAYS = 30
const RETENTION_DAYS = [1, 7, 30] as const

export type WindowStats = {
  activePlayers: number
  newPlayers: number
  queueJoins: number
  queueSeconds: number
  matchesFound: number
  matchesPlayed: number
  cupSignups: number
  pageViews: number
  // Mean wait of the queue entries that found a match
  avgWaitSec: number | null
}

export type ModeStats = { mode: string; queueJoins: number; matchesFound: number; matchesPlayed: number; avgWaitSec: number | null }
export type DayStats = { day: string; activePlayers: number; newPlayers: number; queueJoins: number; matchesFound: number }
export type Retention = { eligible: number; returned: number }
export type Cohort = { week: string; players: number; retention: Record<`d${(typeof RETENTION_DAYS)[number]}`, Retention> }
export type LastAction = { action: string | null; detail: string | null; players: number }

export type ActivityOverview = {
  generatedAt: string
  inactiveDays: number
  totals: {
    players: number
    sessions: number
    pageViews: number
    queueJoins: number
    queueSeconds: number
    matchesFound: number
    matchesPlayed: number
    cupSignups: number
  }
  windows: { "24h": WindowStats; "7d": WindowStats; "30d": WindowStats }
  modes30d: ModeStats[]
  daily: DayStats[]
  cohorts: Cohort[]
  inactivePlayers: number
  lastActions: LastAction[]
}

export type UserActivityView = {
  totals: typeof userActivity.$inferSelect | null
  avgWaitSec: number | null
  events: { kind: string; mode: string | null; ref: string | null; detail: string | null; value: number | null; at: string }[]
}

// Works with both node-postgres and PGlite results
async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const r = (await db.execute(query)) as unknown as { rows?: T[] } | T[]
  return Array.isArray(r) ? r : (r.rows ?? [])
}

const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const iso = (d: Date) => d.toISOString()

async function windowStats(db: Db, since: Date): Promise<WindowStats> {
  const [e] = await rows<Record<string, unknown>>(
    db,
    sql`select
      count(distinct steam_id) filter (where kind <> 'match_end') as active,
      count(*) filter (where kind = 'queue_join' and coalesce(detail, '') <> 'requeue') as queue_joins,
      coalesce(sum(value) filter (where kind in ('queue_leave', 'queue_matched')), 0) as queue_seconds,
      count(*) filter (where kind = 'match_found') as found,
      count(*) filter (where kind = 'match_end' and detail in ('win', 'loss')) as played,
      count(*) filter (where kind = 'cup_signup') as cups,
      count(*) filter (where kind = 'page_view') as pages,
      avg(value) filter (where kind = 'queue_matched') as avg_wait
    from activity_events where at >= ${iso(since)}::timestamptz`,
  )
  const [u] = await rows<{ n: unknown }>(db, sql`select count(*) as n from users where created_at >= ${iso(since)}::timestamptz`)
  return {
    activePlayers: num(e?.active),
    newPlayers: num(u?.n),
    queueJoins: num(e?.queue_joins),
    queueSeconds: num(e?.queue_seconds),
    matchesFound: num(e?.found),
    matchesPlayed: num(e?.played),
    cupSignups: num(e?.cups),
    pageViews: num(e?.pages),
    avgWaitSec: numOrNull(e?.avg_wait),
  }
}

export async function activityOverview(db: Db, now: Date): Promise<ActivityOverview> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS)

  const [t] = await rows<Record<string, unknown>>(
    db,
    sql`select count(*) as players, coalesce(sum(sessions), 0) as sessions, coalesce(sum(page_views), 0) as page_views,
      coalesce(sum(queue_joins), 0) as queue_joins, coalesce(sum(queue_seconds), 0) as queue_seconds,
      coalesce(sum(matches_found), 0) as matches_found, coalesce(sum(matches_played), 0) as matches_played,
      coalesce(sum(cup_signups), 0) as cup_signups
    from user_activity`,
  )

  const [day, week, month] = await Promise.all([windowStats(db, ago(1)), windowStats(db, ago(7)), windowStats(db, ago(30))])

  const modes = await rows<Record<string, unknown>>(
    db,
    sql`select mode,
      count(*) filter (where kind = 'queue_join' and coalesce(detail, '') <> 'requeue') as queue_joins,
      count(*) filter (where kind = 'match_found') as found,
      count(*) filter (where kind = 'match_end' and detail in ('win', 'loss')) as played,
      avg(value) filter (where kind = 'queue_matched') as avg_wait
    from activity_events
    where at >= ${iso(ago(30))}::timestamptz and mode is not null
    group by mode order by mode`,
  )

  // Days are UTC. Multi mode queue joins count once each
  const seriesStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS - (SERIES_DAYS - 1) * DAY_MS)
  const daily = await rows<Record<string, unknown>>(
    db,
    sql`with days as (
      select generate_series(${iso(seriesStart)}::timestamptz, ${iso(now)}::timestamptz, interval '1 day') as day
    )
    select to_char(d.day at time zone 'UTC', 'YYYY-MM-DD') as day,
      (select count(distinct steam_id) from activity_events e
        where e.at >= d.day and e.at < d.day + interval '1 day' and e.kind <> 'match_end') as active,
      (select count(*) from users u where u.created_at >= d.day and u.created_at < d.day + interval '1 day') as new_players,
      (select count(*) from activity_events e
        where e.at >= d.day and e.at < d.day + interval '1 day' and e.kind = 'queue_join' and coalesce(e.detail, '') <> 'requeue') as queue_joins,
      (select count(*) from activity_events e
        where e.at >= d.day and e.at < d.day + interval '1 day' and e.kind = 'match_found') as found
    from days d order by d.day`,
  )

  // A player returned on day N when they did anything at least N days after signing up
  const retentionCols = RETENTION_DAYS.map(
    (n) => sql`,
      count(*) filter (where u.created_at + interval '${sql.raw(String(n))} days' <= ${iso(now)}::timestamptz) as eligible_${sql.raw(String(n))},
      count(*) filter (where exists (
        select 1 from activity_events e
        where e.steam_id = u.steam_id and e.at >= u.created_at + interval '${sql.raw(String(n))} days' and e.kind <> 'match_end'
      ) and u.created_at + interval '${sql.raw(String(n))} days' <= ${iso(now)}::timestamptz) as returned_${sql.raw(String(n))}`,
  )
  const cohorts = await rows<Record<string, unknown>>(
    db,
    sql`select to_char(date_trunc('week', u.created_at at time zone 'UTC'), 'YYYY-MM-DD') as week, count(*) as players
      ${sql.join(retentionCols, sql``)}
    from users u
    where u.created_at >= (date_trunc('week', ${iso(now)}::timestamptz at time zone 'UTC') at time zone 'UTC')
      - interval '${sql.raw(String(COHORT_WEEKS - 1))} weeks'
    group by 1 order by 1 desc`,
  )

  const inactiveSince = iso(ago(INACTIVE_DAYS))
  const [inactive] = await rows<{ n: unknown }>(
    db,
    sql`select count(*) as n from user_activity where last_seen_at < ${inactiveSince}::timestamptz`,
  )
  const last = await rows<Record<string, unknown>>(
    db,
    sql`select last_action as action, last_action_detail as detail, count(*) as players
    from user_activity where last_seen_at < ${inactiveSince}::timestamptz
    group by 1, 2 order by 3 desc, 1, 2 limit 25`,
  )

  return {
    generatedAt: iso(now),
    inactiveDays: INACTIVE_DAYS,
    totals: {
      players: num(t?.players),
      sessions: num(t?.sessions),
      pageViews: num(t?.page_views),
      queueJoins: num(t?.queue_joins),
      queueSeconds: num(t?.queue_seconds),
      matchesFound: num(t?.matches_found),
      matchesPlayed: num(t?.matches_played),
      cupSignups: num(t?.cup_signups),
    },
    windows: { "24h": day, "7d": week, "30d": month },
    modes30d: modes.map((m) => ({
      mode: String(m.mode),
      queueJoins: num(m.queue_joins),
      matchesFound: num(m.found),
      matchesPlayed: num(m.played),
      avgWaitSec: numOrNull(m.avg_wait),
    })),
    daily: daily.map((d) => ({
      day: String(d.day),
      activePlayers: num(d.active),
      newPlayers: num(d.new_players),
      queueJoins: num(d.queue_joins),
      matchesFound: num(d.found),
    })),
    cohorts: cohorts.map((c) => ({
      week: String(c.week),
      players: num(c.players),
      retention: Object.fromEntries(
        RETENTION_DAYS.map((n) => [`d${n}`, { eligible: num(c[`eligible_${n}`]), returned: num(c[`returned_${n}`]) }]),
      ) as Cohort["retention"],
    })),
    inactivePlayers: num(inactive?.n),
    lastActions: last.map((l) => ({
      action: l.action === null ? null : String(l.action),
      detail: l.detail === null ? null : String(l.detail),
      players: num(l.players),
    })),
  }
}

export async function userActivityView(db: Db, steamId: string, limit = 50): Promise<UserActivityView> {
  const [totals] = await db.select().from(userActivity).where(eq(userActivity.steamId, steamId))
  const [wait] = await rows<{ avg: unknown }>(
    db,
    sql`select avg(value) as avg from activity_events where steam_id = ${steamId} and kind = 'queue_matched'`,
  )
  const events = await db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.steamId, steamId))
    .orderBy(desc(activityEvents.at), desc(activityEvents.id))
    .limit(limit)
  return {
    totals: totals ?? null,
    avgWaitSec: numOrNull(wait?.avg),
    events: events.map((e) => ({ kind: e.kind, mode: e.mode, ref: e.ref, detail: e.detail, value: e.value, at: iso(e.at) })),
  }
}
