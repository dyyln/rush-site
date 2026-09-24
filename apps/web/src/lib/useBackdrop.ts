"use client";

import { useEffect } from "react";
import type { Mode } from "@rushsite/shared";

// The scene behind the page. tokens.css maps html[data-backdrop] to an image and
// components/layout/Backdrop crossfades to it when the attribute changes
export type Backdrop = "rush" | "aim";

// Rush wins when a selection mixes both, since it is the headline mode
export function backdropFor(modes: readonly Mode[]): Backdrop | null {
  if (modes.length === 0) return null;
  return modes.includes("rush3v3") ? "rush" : "aim";
}

// Sets the backdrop while the calling page is mounted. No mode keeps the default scene
export function useBackdrop(modes: Mode | readonly Mode[] | null | undefined) {
  const list: readonly Mode[] = modes == null ? [] : typeof modes === "string" ? [modes] : modes;
  const backdrop = backdropFor(list);

  useEffect(() => {
    const root = document.documentElement;
    if (backdrop) root.dataset.backdrop = backdrop;
    else delete root.dataset.backdrop;
    return () => {
      delete root.dataset.backdrop;
    };
  }, [backdrop]);
}
