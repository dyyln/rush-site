import type { Metadata } from "next";
import { BRAND_NAME, RUSH_MAP } from "@rushsite/shared";
import { Breadcrumbs } from "@/components/guide/Breadcrumbs";
import { JsonLd } from "@/components/guide/JsonLd";
import { Tiles } from "@/components/guide/Tiles";
import styles from "@/components/guide/guide.module.css";
import { Card } from "@/components/ui/Card";
import { breadcrumbs, mapImage, playableMaps } from "@/lib/seo";

export const revalidate = 3600;

const description = `Every map in the ${BRAND_NAME} ranked pool: the CS2 aim maps for 1v1 and 2v2 Aim, and Complex, the Rush map, with its arenas.`;

export const metadata: Metadata = {
  title: "CS2 Aim and Rush Maps",
  description,
  alternates: { canonical: "/maps" },
  openGraph: { title: `CS2 Aim and Rush Maps | ${BRAND_NAME}`, description, url: "/maps", images: ["/maps/aim_redline.webp"] },
};

export default async function MapsPage() {
  const maps = await playableMaps();
  const aim = maps.filter((m) => m.id !== RUSH_MAP.id);
  const rush = maps.find((m) => m.id === RUSH_MAP.id);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Maps", path: "/maps" },
  ];
  return (
    <div className="container page">
      <JsonLd data={breadcrumbs(crumbs)} />
      <Breadcrumbs items={crumbs} />
      <header className="page-header">
        <div>
          <h1>Maps</h1>
          <p>The ranked map pool. Aim maps are picked by veto before each match.</p>
        </div>
      </header>
      <section aria-labelledby="aim-heading">
        <h2 id="aim-heading" className={styles.sectionTitle}>
          Aim maps
        </h2>
        <Tiles items={aim.map((m) => ({ key: m.id, name: m.displayName, sub: m.id, art: mapImage(m), href: `/maps/${m.id}` }))} />
      </section>
      {rush && (
        <section aria-labelledby="rush-heading">
          <h2 id="rush-heading" className={styles.sectionTitle}>
            Rush
          </h2>
          <Tiles
            size="lg"
            items={[{ key: rush.id, name: rush.displayName, sub: "Every Rush arena in one map", art: mapImage(rush), href: `/maps/${rush.id}` }]}
          />
        </section>
      )}
      <Card title="Before your first match">
        <div className={styles.prose}>
          <p>
            Aim maps are Steam Workshop maps. Subscribe to them from each map&apos;s page and CS2 downloads them ahead of time, so you join the
            server the moment it is ready. Complex, the Rush map, ships with CS2.
          </p>
        </div>
      </Card>
    </div>
  );
}
