import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@rushsite/shared";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    start_url: "/",
    display: "standalone",
    background_color: "#0f0e13",
    theme_color: "#0f0e13",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
  };
}
