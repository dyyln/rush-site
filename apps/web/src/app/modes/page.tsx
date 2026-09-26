import type { Metadata } from "next";
import { BRAND_NAME } from "@rushsite/shared";
import { Breadcrumbs } from "@/components/guide/Breadcrumbs";
import { JsonLd } from "@/components/guide/JsonLd";
import { Tiles } from "@/components/guide/Tiles";
import styles from "@/components/guide/guide.module.css";
import { Card } from "@/components/ui/Card";
import { breadcrumbs, MODE_ART, MODE_PAGES } from "@/lib/seo";

const description = `Three ranked CS2 modes on ${BRAND_NAME}: 3v3 Rush, 1v1 Aim and 2v2 Aim. Each has its own rating, leaderboard and free cups.`;

export const metadata: Metadata = {
  title: "CS2 Game Modes",
  description,
  alternates: { canonical: "/modes" },
  openGraph: { title: `CS2 Game Modes | ${BRAND_NAME}`, description, url: "/modes", images: [MODE_ART.rush3v3] },
};

export default function ModesPage() {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Modes", path: "/modes" },
  ];
  return (
    <div className="container page">
      <JsonLd data={breadcrumbs(crumbs)} />
      <Breadcrumbs items={crumbs} />
      <header className="page-header">
        <div>
          <h1>Game modes</h1>
          <p>Three ranked modes for CS2, each with its own rating, leaderboard and cups.</p>
        </div>
      </header>
      <Tiles
        size="lg"
        items={MODE_PAGES.map((p) => ({ key: p.slug, name: p.heading, sub: p.lede, art: MODE_ART[p.mode], href: `/modes/${p.slug}` }))}
      />
      <Card title="How ranked play works">
        <div className={styles.prose}>
          <p>
            Sign in with Steam, pick one or more modes and queue alone or with friends. When a match is found everyone accepts, maps are
            vetoed on the site and a dedicated server starts with the connect details on screen.
          </p>
          <p>
            Every mode keeps its own rating from your first match. Climb from Iron to Elite, and enter the free daily and weekly cups once
            your account is Verified.
          </p>
        </div>
      </Card>
    </div>
  );
}
