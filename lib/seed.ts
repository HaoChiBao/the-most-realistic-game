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
  const m = one.match(/wake up (?:in|on)\s+(.*)/i);
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
// Dials are weighted toward grounded, contemporary, street-level worlds (GTA-ish).

function weightedPick(weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** Ten dial digits biased toward normal contemporary settings. */
export function makeDialDigits(): number[] {
  const digits = [
    weightedPick([3, 12, 12, 10, 5, 4, 3, 2, 1, 1]), // D1 world_type — ~77% grounded
    weightedPick([2, 4, 8, 10, 10, 8, 6, 4, 2, 1]), // D2 place — building / block / street
    weightedPick([4, 7, 8, 8, 7, 5, 3, 2, 1, 1]), // D3 isolation — public to sparse
    weightedPick([3, 5, 7, 8, 7, 5, 4, 3, 2, 1]), // D4 law — everyday norms
    weightedPick([4, 6, 7, 7, 6, 5, 4, 3, 2, 1]), // D5 opacity
    weightedPick([3, 5, 7, 8, 7, 5, 4, 3, 2, 1]), // D6 npc agency
    weightedPick([4, 6, 7, 7, 6, 5, 3, 2, 1, 1]), // D7 scarcity — not desperate
    weightedPick([5, 6, 7, 6, 5, 4, 3, 2, 1, 1]), // D8 rule density
    weightedPick([4, 6, 7, 6, 5, 4, 3, 2, 1, 1]), // D9 stickiness
    weightedPick([10, 9, 8, 7, 5, 3, 2, 1, 1, 1]), // D10 tone — dry / realist
  ];
  // Position 1 is never 0 in share codes; remap to grounded 1–3.
  if (digits[0] === 0) digits[0] = 1 + Math.floor(Math.random() * 3);
  return digits;
}

export function makeSeedCode(): string {
  const dials = makeDialDigits().join("");
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
