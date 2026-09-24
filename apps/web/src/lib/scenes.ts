// Full screen Rush scenes from CS2's rush_001 loading screens, 1920x1080 in public/backdrops.
// tokens.css picks the page backdrop from these. Use them anywhere a large scene fits, like a hero or an empty state
export type Scene = { id: string; src: string; width: number; height: number };

const ids = ["rush_001", "rush_001_1", "rush_001_2", "rush_001_3", "rush_001_4"] as const;
export type SceneId = (typeof ids)[number];

export const RUSH_SCENES: readonly Scene[] = ids.map((id) => ({ id, src: `/backdrops/${id}.webp`, width: 1920, height: 1080 }));

export function rushScene(id: SceneId): Scene {
  return RUSH_SCENES.find((s) => s.id === id)!;
}

// The same scene for the same key, like a match or cup id, so a page does not change scene on refresh
export function rushSceneFor(key: string): Scene {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return RUSH_SCENES[h % RUSH_SCENES.length]!;
}
