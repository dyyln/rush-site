import type { MetadataRoute } from "next";
import { MODE_PAGES, playableMaps, SITE_URL } from "@/lib/seo";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const maps = await playableMaps();
  const page = (path: string, priority: number, changeFrequency: "daily" | "weekly" | "monthly" = "weekly") => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  });
  return [
    page("/", 1, "daily"),
    page("/modes", 0.9),
    ...MODE_PAGES.map((p) => page(`/modes/${p.slug}`, 0.9)),
    page("/maps", 0.8),
    ...maps.map((m) => page(`/maps/${m.id}`, 0.7, "monthly")),
    page("/tournaments", 0.8, "daily"),
    page("/leaderboard", 0.7, "daily"),
    page("/ranks", 0.6),
  ];
}
