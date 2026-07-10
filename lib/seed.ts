// Helpers for the seed-sharing feature.
//
// Dual nature of a seed (engine v5.1+):
// 1) First 10 digits = WorldSpec dials that bias NEW world creation.
// 2) Trailing 1–4 digits = instance ID (expands finite dial space; not a dial).
// 3) Stored turn-1 bible (opening + [WORLD]) = exact shareable truth on load.
// Loading /s/CODE never regenerates from digits — it replays the stored bible.
// See lib/worldSpec.ts for dial decode.

import {
  decodeSeed,
  parseSeedCode,
  SEED_DIGIT_COUNT,
  SEED_INSTANCE_ID_LENGTH,
} from "@/lib/worldSpec";

export { decodeSeed, parseSeedCode };
export {
  SEED_DIGIT_COUNT,
  SEED_INSTANCE_ID_LENGTH,
  SEED_CODE_MIN_LENGTH,
  SEED_CODE_MAX_LENGTH,
} from "@/lib/worldSpec";

// Split a raw engine response into its visible scene and hidden world blocks.
export function splitSceneWorld(raw: string): {
  scene: string;
  world: string;
} {
  const sceneM = raw.match(/\[\s*SCENE\s*\]/i);
  const worldM = raw.match(/\[\s*WORLD\s*\]/i);
  const sceneIdx = sceneM ? sceneM.index ?? -1 : -1;
  const worldIdx = worldM ? worldM.index ?? -1 : -1;

  let scene: string;
  let world = "";

  if (sceneIdx !== -1) {
    const start = sceneIdx + sceneM![0].length;
    const end = worldIdx > sceneIdx ? worldIdx : raw.length;
    scene = raw.slice(start, end);
  } else if (worldIdx !== -1) {
    scene = raw.slice(0, worldIdx);
  } else {
    scene = raw;
  }

  if (worldIdx !== -1) {
    world = raw.slice(worldIdx + worldM![0].length);
  }

  return { scene: scene.trim(), world: world.trim() };
}

// Rebuild the raw two-layer message the engine expects in history from a stored
// opening + world. Kept in sync with the [SCENE]/[WORLD] format the model emits.
export function composeRaw(opening: string, world: string): string {
  return `[SCENE]\n${opening.trim()}\n\n[WORLD]\n${world.trim()}`;
}

// A short human-friendly display label pulled from the opening line, e.g.
// "YOU WAKE UP IN A FERRY AT NIGHT." -> "a ferry at night".
export function deriveSetting(opening: string): string {
  const one = opening.replace(/\s+/g, " ").trim();
  const m = one.match(/wake up in\s+(.*)/i);
  let label = (m ? m[1] : one).trim();
  label = label.replace(/[.!]+\s*$/, "");
  if (label.length > 90) label = label.slice(0, 87).trimEnd() + "...";
  return label.toLowerCase();
}

// Seed layout (engine v5.1+):
// [10 dial digits][4 instance ID digits]
// Dials bias NEW world generation; instance ID expands the finite dial space.
// Stored turn-1 bible remains exact share truth on load.

// 14-digit seed: 10 dials + 4-digit instance ID. First dial digit is never zero.
export function makeSeedCode(): string {
  const first = 1 + Math.floor(Math.random() * 9);
  let dials = `${first}`;
  for (let i = 1; i < SEED_DIGIT_COUNT; i++) {
    dials += Math.floor(Math.random() * 10);
  }
  let instanceId = "";
  for (let i = 0; i < SEED_INSTANCE_ID_LENGTH; i++) {
    instanceId += Math.floor(Math.random() * 10);
  }
  return `${dials}${instanceId}`;
}

// Accept 10–14 digit numeric codes (10 dials, optional 1–4 digit instance suffix).
export function isValidCode(code: string): boolean {
  return /^\d{10,14}$/.test(code);
}
