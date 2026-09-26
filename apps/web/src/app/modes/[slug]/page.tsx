import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND_NAME, isRushMode, RUSH_MAP, RUSH_ROOMS } from "@rushsite/shared";
import { Breadcrumbs } from "@/components/guide/Breadcrumbs";
import { ButtonLink } from "@/components/guide/ButtonLink";
import { Faq } from "@/components/guide/Faq";
import { GuideHero } from "@/components/guide/GuideHero";
import { JsonLd } from "@/components/guide/JsonLd";
import { SceneFor } from "@/components/guide/SceneFor";
import { Tiles } from "@/components/guide/Tiles";
import styles from "@/components/guide/guide.module.css";
import { Card } from "@/components/ui/Card";
import { TierChip } from "@/components/ui/TierChip";
import { rushRoomImage } from "@/lib/rushRooms";
import {
  breadcrumbs,
  faqSchema,
  LEADERBOARD_MIN_MATCHES,
  MODE_ART,
  MODE_PAGES,
  mapImage,
  modePage,
  playableMaps,
  topPlayers,
} from "@/lib/seo";

export const revalidate = 3600;

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return MODE_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = modePage((await params).slug);
  if (!page) return {};
  const path = `/modes/${page.slug}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: path },
    openGraph: { title: `${page.title} | ${BRAND_NAME}`, description: page.description, url: path, images: [MODE_ART[page.mode]] },
  };
}

export default async function ModePage({ params }: Params) {
  const page = modePage((await params).slug);
  if (!page) notFound();
  const rush = isRushMode(page.mode);
  const [maps, top] = await Promise.all([playableMaps(), topPlayers(page.mode)]);
  const inMode = maps.filter((m) => m.modes.includes(page.mode));
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Modes", path: "/modes" },
    { name: page.heading, path: `/modes/${page.slug}` },
  ];
  const rooms = [...RUSH_ROOMS.startRooms, ...RUSH_ROOMS.midRooms];

  return (
    <div className={`container page`}>
      <SceneFor modes={[page.mode]} />
      <JsonLd data={breadcrumbs(crumbs)} />
      <JsonLd data={faqSchema(page.faq)} />
      <Breadcrumbs items={crumbs} />
      <GuideHero kicker="Game mode" title={page.heading} lede={page.lede} art={MODE_ART[page.mode]}>
        <ButtonLink href="/play">Play {page.heading}</ButtonLink>
        <ButtonLink href={`/leaderboard?mode=${page.mode}`} variant="secondary">
          Leaderboard
        </ButtonLink>
      </GuideHero>

      <div className={styles.layout}>
        <div className={styles.col}>
          <Card title={`About ${page.heading}`}>
            <div className={styles.prose}>
              {page.intro.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </Card>

          {rush ? (
            <section aria-labelledby="rooms-heading">
              <h2 id="rooms-heading" className={styles.sectionTitle}>
                Rush arenas
              </h2>
              <Tiles
                size="sm"
                items={rooms.map((r) => ({
                  key: String(r.id),
                  name: r.displayName,
                  sub: RUSH_ROOMS.startRooms.some((s) => s.id === r.id) ? "Start room" : "Mid room",
                  art: rushRoomImage(String(r.id)),
                  href: `/maps/${RUSH_MAP.id}`,
                }))}
              />
            </section>
          ) : (
            <section aria-labelledby="maps-heading">
              <h2 id="maps-heading" className={styles.sectionTitle}>
                Map pool
              </h2>
              <Tiles items={inMode.map((m) => ({ key: m.id, name: m.displayName, sub: m.id, art: mapImage(m), href: `/maps/${m.id}` }))} />
            </section>
          )}

          <Faq items={page.faq} />
        </div>

        <div className={styles.col}>
          <Card title="At a glance">
            <dl className={styles.facts}>
              {page.rules.map((r) => (
                <div key={r.label} style={{ display: "contents" }}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Top players" eyebrow={`${page.heading} ladder`}>
            {top.length === 0 ? (
              <p className="muted">No one has placed yet. Play {LEADERBOARD_MIN_MATCHES} match to take the top spot.</p>
            ) : (
              <ol className={styles.top}>
                {top.map((p) => (
                  <li key={p.steamId}>
                    <span className={`mono ${styles.rank}`}>{p.rank}</span>
                    <Link href={`/profile/${p.steamId}`}>{p.displayName}</Link>
                    <TierChip rating={p.rating} size="sm" />
                  </li>
                ))}
              </ol>
            )}
            <p>
              <Link href={`/leaderboard?mode=${page.mode}`}>Full leaderboard</Link>
            </p>
          </Card>

          <Card title="Cups">
            <p className="muted">
              Free {page.heading} cups run every day and every week. Single elimination, open to Verified players, with a badge for the top
              finishers.
            </p>
            <p>
              <Link href="/tournaments">See upcoming cups</Link>
            </p>
          </Card>

          <Card title="Other modes">
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: "var(--space-2)" }}>
              {MODE_PAGES.filter((p) => p.slug !== page.slug).map((p) => (
                <li key={p.slug}>
                  <Link href={`/modes/${p.slug}`}>{p.heading}</Link>
                </li>
              ))}
              <li>
                <Link href="/ranks">Ranks and tiers</Link>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
