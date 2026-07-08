// Helpers for the seed-sharing feature. A "seed" is the pristine turn-1 world:
// the visible opening [SCENE] plus the hidden [WORLD] bible. Storing that exact
// content (rather than an RNG number) is the only way to reproduce a world,
// since the LLM engine is non-deterministic.

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

// 10-digit numeric seed code, e.g. "8194023475". First digit is never zero so
// the code is always a full 10 characters.
export function makeSeedCode(): string {
  const first = 1 + Math.floor(Math.random() * 9);
  let rest = "";
  for (let i = 0; i < 9; i++) rest += Math.floor(Math.random() * 10);
  return `${first}${rest}`;
}

// Accept only 6-12 digit numeric codes.
export function isValidCode(code: string): boolean {
  return /^\d{6,12}$/.test(code);
}
