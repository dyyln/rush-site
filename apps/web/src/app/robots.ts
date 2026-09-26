import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Account pages, one off links and mockups
      disallow: ["/admin", "/settings", "/login", "/banned", "/friends", "/invite/", "/challenge/", "/design"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
