import {
  extractConditionsFromState,
  formatConditionsOverview,
} from "../lib/conditions";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const state = {
  player: {
    id: "player",
    conditions: [
      {
        id: "c1",
        kind: "exposure",
        label: "hypothermia",
        subject: "player",
        severity: 45,
        stage: "moderate",
        progress: "worsening",
        turns_active: 4,
        death_risk: "medium",
      },
    ],
  },
  characters: [
    {
      id: "medic",
      conditions: [
        {
          id: "c2",
          kind: "trauma",
          label: "gunshot wound",
          subject: "medic",
          severity: 80,
          stage: "critical",
          progress: "stable",
          turns_active: 2,
          death_risk: "high",
        },
      ],
    },
  ],
};

const bundle = extractConditionsFromState(state);
assert(bundle.player.length === 1, "player condition");
assert(bundle.npc.length === 1, "npc condition");
assert(bundle.all.length === 2, "all conditions");

const text = formatConditionsOverview(bundle);
assert(text.includes("hypothermia"), "overview text");
assert(text.includes("exposure"), "kind in overview");

console.log("conditions tests passed");
