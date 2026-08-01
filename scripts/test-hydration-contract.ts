import assert from "node:assert/strict";
import { assertHydrationContract } from "../lib/hydrationContract";
import { mergeHydrationIntoOpeningDetailed } from "../lib/stateMerge";

const full = {
  world_type: "grounded",
  player_location: "lot",
  locations: [{ id: "lot", exits: ["street"] }],
  player: {
    id: "player",
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
  },
  characters: [
    {
      id: "npc_1",
      name: "Jamal",
      training: "professional",
      disposition: "neutral",
      violence: "call_help",
    },
  ],
  laws: [{ id: "l1" }, { id: "l2" }],
  starting_plot: { id: "plot", phase: "setup", hook: "a ticket" },
  clock: { turn: 1 },
  heat: { level: 0, response: "none" },
};

{
  const ok = assertHydrationContract(full, { lawCount: 2, worldType: "grounded" });
  assert.equal(ok.ok, true);
  assert.equal(ok.failures.length, 0);
}

{
  const thin = assertHydrationContract(
    {
      world_type: "fantastical",
      player_location: "lot",
      locations: [{ id: "lot", exits: [] }],
      player: { id: "player" },
      characters: [{ id: "x", name: "X" }],
      laws: [],
      clock: { turn: 1 },
    },
    { lawCount: 3, worldType: "grounded" }
  );
  assert.equal(thin.ok, false);
  assert.ok(thin.failures.some((f) => f.includes("laws")));
  assert.ok(thin.failures.some((f) => f.includes("exit")));
  assert.ok(thin.failures.some((f) => f.includes("persona")));
  assert.ok(thin.failures.some((f) => f.includes("starting_plot")));
  assert.ok(thin.failures.some((f) => f.includes("world_type")));
  // Still playable after patch
  assert.ok(thin.state.player);
  assert.ok(thin.state.starting_plot);
  assert.equal(thin.state.world_type, "grounded");
}

{
  const opening = `[SCENE]\nWake.\n[WORLD]\nSTATE\n${JSON.stringify({
    world_type: "grounded",
    player_location: "lot",
    locations: [{ id: "lot", exits: ["street"] }],
    player: full.player,
    characters: [],
    laws: [],
    clock: { turn: 1 },
  })}`;
  const hydrate = `[WORLD]\nSTATE\n${JSON.stringify({
    characters: full.characters,
    laws: full.laws,
    starting_plot: full.starting_plot,
  })}`;
  const merged = mergeHydrationIntoOpeningDetailed(opening, hydrate);
  const contract = assertHydrationContract(merged.state, { lawCount: 2 });
  assert.equal(contract.ok, true);
}

console.log("hydrationContract tests passed");
