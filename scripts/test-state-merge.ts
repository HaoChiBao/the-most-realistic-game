import assert from "node:assert/strict";
import {
  getLastCanonicalState,
  mergeDeltaState,
  resolveCanonicalAssistantContent,
  rewriteWorldState,
} from "../lib/stateMerge";
import { extractStateJson } from "../lib/stateParse";

const full: Record<string, unknown> = {
  world_type: "grounded",
  player_location: "garage",
  clock: { turn: 1, time_of_day: "night" },
  player: {
    id: "player",
    stats: { hp: 100, combat: 20 },
    conditions: [],
    inventory: [{ id: "lighter", name: "lighter" }],
  },
  characters: [
    {
      id: "mills",
      name: "Mills",
      role: "officer",
      disposition: "neutral",
      stats: { combat: 55, firearms: 60 },
      memory: [{ turn: 1, event: "first sight", emotional_weight: "low" }],
    },
  ],
  heat: { level: 0, response: "none" },
  random_log: [{ turn: 1, table: "ambient", tier: "common", outcome: "wind" }],
};

const delta: Record<string, unknown> = {
  clock: { turn: 2, time_of_day: "night" },
  player: { stats: { hp: 92 } },
  characters: [
    {
      id: "mills",
      disposition: "hostile",
      combat_posture: "aggressive",
      memory: [{ turn: 2, event: "player swung", emotional_weight: "high" }],
    },
  ],
  heat: { level: 2, response: "local" },
  random_log: [{ turn: 2, table: "crime", tier: "uncommon", outcome: "sirens" }],
};

const merged = mergeDeltaState(full, delta);
assert.equal((merged.clock as { turn: number }).turn, 2);
assert.equal((merged.player as { stats: { hp: number } }).stats.hp, 92);
assert.equal((merged.player as { stats: { combat: number } }).stats.combat, 20);
const mills = (merged.characters as Record<string, unknown>[]).find(
  (c) => c.id === "mills"
)!;
assert.equal(mills.disposition, "hostile");
assert.equal((mills.memory as unknown[]).length, 2);
assert.equal((merged.heat as { level: number }).level, 2);
assert.equal((merged.random_log as unknown[]).length, 2);
assert.equal(merged.world_type, "grounded");

const raw =
  "[SCENE]\nHe swings.\n[WORLD]\nSTATE\n" + JSON.stringify(delta);
const rewritten = rewriteWorldState(raw, merged);
const parsed = extractStateJson(rewritten) as Record<string, unknown>;
assert.equal((parsed.characters as unknown[]).length, 1);
assert.equal(parsed.world_type, "grounded");

const history = [
  {
    role: "assistant" as const,
    content: `[SCENE]\nOpen.\n[WORLD]\nSTATE\n${JSON.stringify(full)}`,
  },
];
const resolved = resolveCanonicalAssistantContent(history, raw);
const resolvedState = extractStateJson(resolved) as Record<string, unknown>;
assert.equal(
  (resolvedState.characters as Record<string, unknown>[])[0].disposition,
  "hostile"
);
assert.equal(getLastCanonicalState(history)?.world_type, "grounded");

// Top-level + player conditions patch by id (not replace entire array).
const withCond = mergeDeltaState(
  {
    ...full,
    conditions: [
      {
        id: "bleed_arm",
        kind: "trauma",
        label: "arm wound",
        severity: 2,
        stage: "mild",
      },
    ],
    player: {
      ...(full.player as Record<string, unknown>),
      conditions: [
        {
          id: "cuff",
          kind: "restraint",
          label: "handcuffed",
          severity: 5,
          stage: "moderate",
        },
      ],
    },
  },
  {
    clock: { turn: 3 },
    conditions: [{ id: "bleed_arm", severity: 5, stage: "severe" }],
    player: {
      conditions: [{ id: "cuff", severity: 6, stage: "severe" }],
    },
  }
);
const topCond = (withCond.conditions as Record<string, unknown>[])[0];
assert.equal(topCond.severity, 5);
assert.equal(topCond.stage, "severe");
const playerCond = (
  (withCond.player as Record<string, unknown>).conditions as Record<
    string,
    unknown
  >[]
)[0];
assert.equal(playerCond.severity, 6);

console.log("stateMerge tests passed");
