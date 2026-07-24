import assert from "node:assert/strict";
import {
  ensureBootstrapFields,
  mergeHydrationIntoOpening,
  minimalBootstrapState,
  resolveCanonicalAssistantContent,
  stateHasPlayer,
} from "../lib/stateMerge";
import { extractStateJson } from "../lib/stateParse";

const bootstrapPlayer = {
  id: "player",
  inventory: [],
  body: {
    head: "ok",
    torso: "ok",
    left_arm: "ok",
    right_arm: "ok",
    left_leg: "ok",
    right_leg: "ok",
  },
  stats: {
    hp: 100,
    stamina: 80,
    pain: 0,
    combat: 20,
    firearms: 15,
    awareness: 40,
    composure: 50,
    mobility: 100,
  },
  conditions: [],
  conscious: true,
  alive: true,
};

const bootstrapState = {
  world_type: "grounded",
  player_location: "parking_lot_01",
  locations: [
    {
      id: "parking_lot_01",
      exits: ["street"],
      tags: ["outdoor"],
      known_to_player: true,
    },
  ],
  player: bootstrapPlayer,
  characters: [],
  clock: { turn: 1 },
  heat: { level: 0, response: "none" },
  threads: [],
  laws: [],
  consequences: [],
  random_log: [],
  noticed_before: [],
};

const hydrateDelta = {
  characters: [
    {
      id: "npc_1",
      name: "Jamal",
      role: "parking lot security guard",
      location: "parking_lot_01",
      stats: { hp: 90, combat: 55 },
      body: { head: "ok", torso: "ok" },
      disposition: "neutral",
      will_fight_back: true,
      training: "professional",
    },
  ],
  laws: [{ id: "law_parking_rules", known_to_player: false }],
  threads: [
    {
      id: "thread_1",
      name: "Unauthorized Parking",
      status: "active",
    },
  ],
  end_clauses: [{ id: "player_death", when: "player hp 0", label: "DEATH" }],
  ambient_hooks: ["distant siren"],
  starting_plot: { id: "parking_lot_mystery", phase: "setup" },
};

const openingRaw = `[SCENE]
YOU WAKE UP IN A PARKING LOT.

[WORLD]
STATE
${JSON.stringify(bootstrapState)}`;

const hydrateRaw = `[WORLD]
STATE
${JSON.stringify(hydrateDelta)}`;

// 1) Happy path: hydrate omits player → player preserved
{
  const merged = mergeHydrationIntoOpening(openingRaw, hydrateRaw);
  const state = extractStateJson(merged) as Record<string, unknown>;
  assert.ok(stateHasPlayer(state), "hydrate keeps player");
  assert.equal(
    (state.player as { stats: { hp: number } }).stats.hp,
    100,
    "player hp preserved"
  );
  assert.equal(state.player_location, "parking_lot_01", "location preserved");
  assert.equal((state.characters as unknown[]).length, 1, "npc added");
  assert.equal(
    (state.characters as { name: string }[])[0].name,
    "Jamal",
    "npc name"
  );
  assert.ok(Array.isArray(state.laws) && state.laws.length === 1, "laws added");
}

// 2) Regression: unparseable Phase A + hydrate-without-player must NOT wipe player
{
  const brokenOpening = `[SCENE]
YOU WAKE UP IN A PARKING LOT.

[WORLD]
STATE
{"player_location":"parking_lot_01","player":{"id":"player","stats":{"hp":100},"body":{"head":"ok"`;

  const merged = mergeHydrationIntoOpening(brokenOpening, hydrateRaw);
  const state = extractStateJson(merged) as Record<string, unknown>;
  assert.ok(state, "rewritten opening has parseable STATE");
  assert.ok(stateHasPlayer(state), "broken Phase A still yields player after hydrate");
  assert.equal(
    (state.player as { stats: { hp: number } }).stats.hp,
    100,
    "default/scaffold player has hp"
  );
  assert.equal((state.characters as unknown[]).length, 1, "hydrate NPCs still merge");
  // Must not look like hydrate-only world (the production bug).
  assert.notEqual(
    JSON.stringify(Object.keys(state).sort()),
    JSON.stringify(Object.keys(hydrateDelta).sort()),
    "result is not hydrate-delta-only"
  );
}

// 3) ensureBootstrapFields fills missing player
{
  const fixed = ensureBootstrapFields({
    characters: [{ id: "npc_1", location: "lot_a" }],
  });
  assert.ok(stateHasPlayer(fixed), "ensure adds player");
  assert.equal(fixed.player_location, "lot_a", "infers location from NPC");
  assert.equal(
    (fixed.player as { stats: { hp: number } }).stats.hp,
    100,
    "default hp"
  );
}

// 4) Turn resolve with missing prior STATE still keeps player
{
  const lookAround = `[SCENE]
Cars and a guard.
[WORLD]
STATE
${JSON.stringify({
    clock: { turn: 2 },
    characters: [{ id: "npc_1", disposition: "cautious" }],
  })}`;

  const resolved = resolveCanonicalAssistantContent([], lookAround);
  const state = extractStateJson(resolved) as Record<string, unknown>;
  assert.ok(stateHasPlayer(state), "canonical resolve scaffolds player");
  assert.equal((state.clock as { turn: number }).turn, 2, "clock from delta");
}

// 5) Scaffold sanity
{
  const scaffold = minimalBootstrapState();
  assert.ok(stateHasPlayer(scaffold), "scaffold has player");
  assert.equal(scaffold.player_location, "unknown");
}

console.log("opening hydrate tests passed");
