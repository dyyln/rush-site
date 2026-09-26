"use client";

import type { Mode } from "@rushsite/shared";
import { useBackdrop } from "@/lib/useBackdrop";

// Server pages set the scene through this
export function SceneFor({ modes }: { modes: readonly Mode[] }) {
  useBackdrop(modes);
  return null;
}
