import assert from "node:assert/strict";
import { validateStateTransition } from "../lib/stateValidate";
import { commitAssistantState } from "../lib/stateMerge";

const base = {
  world_type: "grounded",
  player_location: "room_a",
  locations: [
    { id: "room_a", exits: ["room_b"] },
    { id: "room_b", exits: ["room_a"] },
  ],
  player: {
    id: "player",
    alive: true,
    conscious: true,
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
    abilities: [],
    flags: [],
    conditions: [],
    inventory: [],
  },
  characters: [{ id: "mills", name: "Mills", role: "officer" }],
  clock: { turn: 1 },
  heat: { level: 0, response: "none" },
};

// clock.turn must increase on player turns → repair
{
  const next = {
    ...base,
    clock: { turn: 1 },
    player_location: "room_a",
  };
  const r = validateStateTransition(base, next, { isPlayerTurn: true });
  assert.equal(r.rejected, false);
  assert.equal((r.state.clock as { turn: number }).turn, 2);
  assert.ok(r.issues.some((i) => i.code === "clock_turn"));
}

// unknown player_location → reject
{
  const next = { ...base, player_location: "void_space", clock: { turn: 2 } };
  const r = validateStateTransition(base, next, { isPlayerTurn: true });
  assert.equal(r.rejected, true);
  assert.ok(r.issues.some((i) => i.code === "unknown_location"));
}

// illegal move off exit graph → reject
{
  const next = {
    ...base,
    player_location: "room_b",
    locations: [
      { id: "room_a", exits: [] },
      { id: "room_b", exits: [] },
    ],
    clock: { turn: 2 },
  };
  // room_a has no exits in next; prev had room_b exit — use prev exits
  const r = validateStateTransition(
    {
      ...base,
      locations: [
        { id: "room_a", exits: ["hallway"] },
        { id: "hallway", exits: ["room_a"] },
        { id: "room_b", exits: [] },
      ],
    },
    next,
    { isPlayerTurn: true }
  );
  assert.equal(r.rejected, true);
  assert.ok(r.issues.some((i) => i.code === "illegal_move"));
}

// legal move along exits
{
  const next = {
    ...base,
    player_location: "room_b",
    clock: { turn: 2 },
  };
  const r = validateStateTransition(base, next, { isPlayerTurn: true });
  assert.equal(r.rejected, false);
  assert.equal(r.state.player_location, "room_b");
}

// alive false → true without resurrection → reject
{
  const dead = {
    ...base,
    player: { ...base.player, alive: false },
  };
  const next = {
    ...dead,
    player: { ...base.player, alive: true },
    clock: { turn: 2 },
  };
  const r = validateStateTransition(dead, next, { isPlayerTurn: true });
  assert.equal(r.rejected, true);
  assert.ok(r.issues.some((i) => i.code === "alive_teleport"));
}

// stats clamp repair
{
  const next = {
    ...base,
    clock: { turn: 2 },
    player: {
      ...base.player,
      stats: { ...base.player.stats, hp: 999, combat: -5, weird: 50 },
    },
  };
  const r = validateStateTransition(base, next, { isPlayerTurn: true });
  const stats = (r.state.player as { stats: Record<string, number> }).stats;
  assert.equal(stats.hp, 100);
  assert.equal(stats.combat, 0);
  assert.equal(stats.weird, undefined);
  assert.ok(r.issues.some((i) => i.code === "stats_clamp"));
}

// grounded magic ability → reject
{
  const next = {
    ...base,
    clock: { turn: 2 },
    player: {
      ...base.player,
      abilities: ["fireball spell"],
    },
  };
  const r = validateStateTransition(base, next, { isPlayerTurn: true });
  assert.equal(r.rejected, true);
  assert.ok(r.issues.some((i) => i.code === "grounded_ability"));
}

// SCENE name without sheet → warn
{
  const next = { ...base, clock: { turn: 2 } };
  const r = validateStateTransition(base, next, {
    isPlayerTurn: true,
    scene: "Officer Diaz steps into the alley.",
  });
  assert.ok(r.issues.some((i) => i.code === "scene_name_unregistered"));
}

// commitAssistantState keeps previous bible on hard reject
{
  const history = [
    {
      role: "assistant" as const,
      content: `[SCENE]\nHere.\n[WORLD]\nSTATE\n${JSON.stringify(base)}`,
    },
  ];
  const committed = commitAssistantState(
    history,
    `[SCENE]\nPoof.\n[WORLD]\nSTATE\n${JSON.stringify({
      clock: { turn: 2 },
      player_location: "moon_base",
    })}`,
    { isPlayerTurn: true }
  );
  assert.equal(committed.rejected, true);
  assert.equal(committed.bible.player_location, "room_a");
}

console.log("stateValidate tests passed");
