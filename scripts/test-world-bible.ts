import assert from "node:assert/strict";
import {
  emptyWorldBible,
  getBible,
  normalizeWorldBible,
  worldBibleFromHistory,
  worldBibleToRecord,
} from "../lib/worldBible";
import {
  commitAssistantState,
  mergeHydrationIntoOpeningDetailed,
} from "../lib/stateMerge";

const bootstrap = {
  world_type: "grounded",
  player_location: "parking_lot_01",
  locations: [
    { id: "parking_lot_01", exits: ["street"], known_to_player: true },
  ],
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
    inventory: [],
    conditions: [],
    conscious: true,
    alive: true,
  },
  characters: [],
  clock: { turn: 1 },
  heat: { level: 0, response: "none" },
  laws: [],
  threads: [],
};

{
  const bible = normalizeWorldBible(bootstrap);
  assert.equal(bible.world_type, "grounded");
  assert.equal(bible.player_location, "parking_lot_01");
  assert.equal(bible.locations.length, 1);
  assert.equal(bible.player.stats.hp, 100);
  assert.equal(bible.clock.turn, 1);

  const round = normalizeWorldBible(worldBibleToRecord(bible));
  assert.equal(round.player_location, "parking_lot_01");
  assert.equal(round.locations[0]?.id, "parking_lot_01");
}

{
  const sparse = normalizeWorldBible({ world_type: "heightened" });
  assert.equal(sparse.world_type, "heightened");
  assert.ok(sparse.player.alive);
  assert.ok(sparse.player.body.head);
  assert.equal(sparse.player_location, "unknown");
}

{
  const empty = emptyWorldBible();
  assert.equal(empty.world_type, "grounded");
  assert.equal(empty.characters.length, 0);
}

{
  const opening = `[SCENE]\nWake.\n[WORLD]\nSTATE\n${JSON.stringify(bootstrap)}`;
  const history = [{ role: "assistant" as const, content: opening }];
  const fromHist = worldBibleFromHistory(history);
  assert.ok(fromHist);
  assert.equal(fromHist!.player_location, "parking_lot_01");
  assert.equal(getBible(history)?.player_location, "parking_lot_01");

  const session = emptyWorldBible();
  session.player_location = "session_room";
  assert.equal(getBible(history, session)?.player_location, "session_room");
}

{
  const opening = `[SCENE]\nWake.\n[WORLD]\nSTATE\n${JSON.stringify(bootstrap)}`;
  const hydrate = `[WORLD]\nSTATE\n${JSON.stringify({
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
    starting_plot: { id: "p1", phase: "setup" },
  })}`;
  const merged = mergeHydrationIntoOpeningDetailed(opening, hydrate);
  assert.equal(merged.bible.characters.length, 1);
  assert.equal(merged.bible.characters[0]?.id, "npc_1");
  assert.equal(merged.bible.player.stats.hp, 100);
  assert.ok(merged.bible.starting_plot);
}

{
  const history = [
    {
      role: "assistant" as const,
      content: `[SCENE]\nOpen.\n[WORLD]\nSTATE\n${JSON.stringify(bootstrap)}`,
    },
  ];
  const committed = commitAssistantState(
    history,
    `[SCENE]\nYou walk.\n[WORLD]\nSTATE\n${JSON.stringify({
      clock: { turn: 2 },
      player_location: "street",
      locations: [
        { id: "parking_lot_01", exits: ["street"] },
        { id: "street", exits: ["parking_lot_01"] },
      ],
    })}`,
    { isPlayerTurn: true }
  );
  assert.equal(committed.bible.clock.turn, 2);
  assert.equal(committed.bible.player_location, "street");
  assert.equal(committed.rejected, false);
}

console.log("worldBible tests passed");
