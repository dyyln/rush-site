import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND_NAME, RUSH_MAP, RUSH_ROOMS, RUSH_RULES, type PublicMap } from "@rushsite/shared";
import { Breadcrumbs } from "@/components/guide/Breadcrumbs";
import { ButtonLink } from "@/components/guide/ButtonLink";
import { GuideHero } from "@/components/guide/GuideHero";
import { JsonLd } from "@/components/guide/JsonLd";
import { SceneFor } from "@/components/guide/SceneFor";
import { Tiles } from "@/components/guide/Tiles";
import styles from "@/components/guide/guide.module.css";
import { Card } from "@/components/ui/Card";
import { rushRoomImage } from "@/lib/rushRooms";
import { breadcrumbs, mapImage, mapNote, MODE_COPY, modePath, playableMaps, rankedModesOf, workshopUrl } from "@/lib/seo";

export const revalidate = 3600;

type Params = { params: Promise<{ id: string }> };

async function findMap(id: string): Promise<{ map: PublicMap; all: PublicMap[] } | null> {
  const all = await playableMaps();
  const map = all.find((m) => m.id === id);
  return map ? { map, all } : null;
}

function modeNames(m: PublicMap): string {
  return rankedModesOf(m)
    .map((mode) => MODE_COPY[mode].label)
    .join(" and ");
}

function describe(m: PublicMap): string {
  const rush = m.id === RUSH_MAP.id;
  const modes = modeNames(m);
  return rush
    ? `Complex (rush_001) is the CS2 Rush map. See every Rush arena, the rules and how to play Rush 3v3 ranked on ${BRAND_NAME}.`
    : `${m.displayName} (${m.id}) is a CS2 aim map in the ${BRAND_NAME} ranked pool${modes ? ` for ${modes}` : ""}. Get the Workshop map and play it on dedicated servers.`;
}

export async function generateStaticParams() {
  return (await playableMaps()).map((m) => ({ id: m.id }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await findMap((await params).id);
  if (!found) return {};
  const { map } = found;
  const title = map.id === RUSH_MAP.id ? "Complex, the CS2 Rush Map" : `${map.displayName} (${map.id}) CS2 Aim Map`;
  const description = describe(map);
  const path = `/maps/${map.id}`;
  const art = mapImage(map);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${title} | ${BRAND_NAME}`, description, url: path, ...(art ? { images: [art] } : {}) },
  };
}

export default async function MapPage({ params }: Params) {
  const found = await findMap((await params).id);
  if (!found) notFound();
  const { map, all } = found;
  const rush = map.id === RUSH_MAP.id;
  const modes = rankedModesOf(map);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Maps", path: "/maps" },
    { name: map.displayName, path: `/maps/${map.id}` },
  ];
  const others = all.filter((m) => m.id !== map.id && m.id !== RUSH_MAP.id);

  return (
    <div className="container page">
      <SceneFor modes={modes} />
      <JsonLd data={breadcrumbs(crumbs)} />
      <Breadcrumbs items={crumbs} />
      <GuideHero kicker={rush ? "Rush map" : "Aim map"} title={map.displayName} lede={mapNote(map)} art={mapImage(map)}>
        <ButtonLink href="/play">Play now</ButtonLink>
        {map.workshopId && (
          <ButtonLink href={workshopUrl(map.workshopId)} variant="secondary">
            Steam Workshop
          </ButtonLink>
        )}
      </GuideHero>

      <div className={styles.layout}>
        <div className={styles.col}>
          {rush ? (
            <>
              <Card title="How Complex works">
                <div className={styles.prose}>
                  <p>
                    Complex holds every Rush arena in one map. Each match lines up {RUSH_RULES.roomSlots} rooms: a castle for each team, the
                    start room in the middle and two rooms on either side of it. The rooms are drawn when the map loads.
                  </p>
                  <p>
                    Each round is fought in one room. The winning team pushes the fight one room toward the other team&apos;s castle. Win{" "}
                    {RUSH_RULES.roundsToWin} rounds, or win a round in the enemy castle, to take the match. At 7 to 7 the Convoy room decides
                    it.
                  </p>
                  <p>Complex ships with CS2, so there is nothing to download before a match.</p>
                </div>
              </Card>
              <section aria-labelledby="start-heading">
                <h2 id="start-heading" className={styles.sectionTitle}>
                  Start rooms
                </h2>
                <Tiles
                  size="sm"
                  items={RUSH_ROOMS.startRooms.map((r) => ({ key: String(r.id), name: r.displayName, art: rushRoomImage(String(r.id)) }))}
                />
              </section>
              <section aria-labelledby="mid-heading">
                <h2 id="mid-heading" className={styles.sectionTitle}>
                  Mid rooms
                </h2>
                <Tiles
                  size="sm"
                  items={RUSH_ROOMS.midRooms.map((r) => ({ key: String(r.id), name: r.displayName, art: rushRoomImage(String(r.id)) }))}
                />
              </section>
              <section aria-labelledby="castle-heading">
                <h2 id="castle-heading" className={styles.sectionTitle}>
                  Castles and decider
                </h2>
                <Tiles
                  size="sm"
                  items={[RUSH_ROOMS.castles.t, RUSH_ROOMS.castles.ct, RUSH_ROOMS.decider].map((r) => ({
                    key: String(r.id),
                    name: r.displayName,
                    art: rushRoomImage(String(r.id)),
                  }))}
                />
              </section>
            </>
          ) : (
            <Card title={`Playing ${map.displayName}`}>
              <div className={styles.prose}>
                <p>{mapNote(map)}</p>
                <p>
                  {map.displayName} is in the ranked pool{modes.length ? ` for ${modeNames(map)}` : ""}. Matches are first to 13 rounds, and the
                  map is chosen by a ban veto on the site before the server starts.
                </p>
                {map.workshopId && (
                  <p>
                    Subscribe to it on the Steam Workshop before you queue. CS2 then has the map ready and you join the server without
                    waiting for a download.
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className={styles.col}>
          <Card title="Map details">
            <dl className={styles.facts}>
              <dt>Name</dt>
              <dd>{map.displayName}</dd>
              <dt>File</dt>
              <dd className="mono">{map.id}</dd>
              <dt>Modes</dt>
              <dd>
                {modes.map((mode, i) => (
                  <span key={mode}>
                    {i > 0 && ", "}
                    <Link href={modePath(mode)!}>{MODE_COPY[mode].label}</Link>
                  </span>
                ))}
              </dd>
              {map.workshopId && (
                <>
                  <dt>Workshop</dt>
                  <dd>
                    <a href={workshopUrl(map.workshopId)} target="_blank" rel="noopener noreferrer" className="mono">
                      {map.workshopId}
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </Card>

          {others.length > 0 && (
            <Card title="Other maps">
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: "var(--space-2)" }}>
                {others.map((m) => (
                  <li key={m.id}>
                    <Link href={`/maps/${m.id}`}>{m.displayName}</Link>
                  </li>
                ))}
                {!rush && (
                  <li>
                    <Link href={`/maps/${RUSH_MAP.id}`}>Complex (Rush)</Link>
                  </li>
                )}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
