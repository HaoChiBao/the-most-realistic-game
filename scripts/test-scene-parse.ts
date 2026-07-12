import {
  coalesceSceneText,
  ensureAssistantHasScene,
  hasWorldMarker,
  isLeakedEngineMarkup,
  parseScene,
  stripControlTokens,
  EMPTY_SCENE_FALLBACK,
} from "../lib/sceneParse";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const soft = parseScene(
  "[SCENE]\nThe blast fades.\n<ENDLABEL>STARTING PLOT RESOLVED</ENDLABEL><SOFT_END>\n[WORLD]\nSTATE\n{}"
);
assert(soft.softEnded === true, "expected softEnded");
assert(soft.ended === false, "soft end must not hard-end");
assert(soft.endLabel === "STARTING PLOT RESOLVED", "soft label");
assert(!soft.scene.includes("SOFT_END"), "token stripped from scene");

const hard = parseScene(
  "[SCENE]\nYou fall.\n<ENDLABEL>KILLED IN FIGHT</ENDLABEL><END>\n[WORLD]\nSTATE\n{}"
);
assert(hard.ended === true, "expected hard end");
assert(hard.softEnded === false, "hard end clears soft");
assert(hard.endLabel === "KILLED IN FIGHT", "hard label");

const both = parseScene(
  "[SCENE]\nx<ENDLABEL>X</ENDLABEL><SOFT_END><END>\n[WORLD]\ny"
);
assert(both.ended === true && both.softEnded === false, "hard wins over soft");

const diverge = parseScene("[SCENE]\nx<DIVERGE><SOFT_END><END><ENDLABEL>L</ENDLABEL>\n[WORLD]\ny");
assert(diverge.diverged === true, "diverge detected");
assert(!diverge.scene.includes("DIVERGE"), "diverge token stripped");

// No [SCENE] marker — never leak bare STATE JSON.
const noMarker = parseScene('{"world_type":"grounded","player_location":"x"}');
assert(noMarker.scene === "", "no scene for bare JSON");

// Model often omits [SCENE] but includes [WORLD] — still show prose.
const noSceneMarker = parseScene(
  "You open the wallet. Inside are a few bills.\n\n[WORLD]\nSTATE\n{\"world_type\":\"grounded\"}"
);
assert(
  noSceneMarker.scene === "You open the wallet. Inside are a few bills.",
  "prose without [SCENE] marker"
);

// STATE without [WORLD] must not extend the visible scene.
const stateOnly = parseScene(
  "[SCENE]\nYou stand in rain.\nSTATE\n{\"world_type\":\"grounded\"}"
);
assert(stateOnly.scene === "You stand in rain.", "truncate at STATE line");

// WORLD-first response must not leak markers into the visible scene.
const worldOnly = parseScene(
  "[WORLD]\nSTATE\n{\"clock\":{\"turn\":11},\"player_location\":\"hall\"}"
);
assert(worldOnly.scene === "", "WORLD-first response has no visible scene");

const worldStatePartial = parseScene("[WORLD]\nSTATE");
assert(worldStatePartial.scene === "", "WORLD + STATE partial has no visible scene");

assert(
  isLeakedEngineMarkup("[WORLD]") && isLeakedEngineMarkup("[WORLD]\nSTATE"),
  "engine markup detected"
);
assert(
  coalesceSceneText("") === EMPTY_SCENE_FALLBACK,
  "empty scene coalesces to fallback"
);
assert(
  coalesceSceneText("[WORLD]") === EMPTY_SCENE_FALLBACK,
  "leaked markup coalesces to fallback"
);

const repaired = ensureAssistantHasScene(
  "[WORLD]\nSTATE\n{\"clock\":{\"turn\":11}}"
);
assert(repaired.startsWith("[SCENE]"), "ensureAssistantHasScene adds SCENE");
assert(hasWorldMarker(repaired), "ensureAssistantHasScene keeps WORLD");

assert(hasWorldMarker("[SCENE]\na\n[WORLD]\nSTATE\n{}") === true, "world marker");
assert(hasWorldMarker("[SCENE]\nonly scene") === false, "no world marker");

const cleaned = stripControlTokens(
  "[SCENE]\na<DIVERGE><SOFT_END><END><ENDLABEL>L</ENDLABEL>\n[WORLD]\nb"
);
assert(!cleaned.includes("<END>"), "strip END");
assert(!cleaned.includes("SOFT_END"), "strip SOFT_END");
assert(!cleaned.includes("DIVERGE"), "strip DIVERGE");
assert(!cleaned.includes("ENDLABEL"), "strip ENDLABEL");

console.log("sceneParse tests passed");
