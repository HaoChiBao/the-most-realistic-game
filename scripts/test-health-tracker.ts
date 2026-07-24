import assert from "node:assert/strict";
import {
  applyHealthDamage,
  calculateDamage,
  heuristicAssessment,
  shouldAssessHealth,
  type HarmAssessment,
} from "../lib/healthTracker";
import { extractStateJson } from "../lib/stateParse";
import { rewriteWorldState } from "../lib/stateMerge";

// --- shouldAssessHealth ---
{
  const gate = shouldAssessHealth(
    [{ role: "user", content: "I punch the guard" }],
    "The guard blocks."
  );
  assert.equal(gate.assess, true);
  assert.equal(gate.reason, "player_violence");
}

{
  const gate = shouldAssessHealth(
    [{ role: "user", content: "I look around" }],
    "A soft wind moves through the alley."
  );
  assert.equal(gate.assess, false);
}

{
  const gate = shouldAssessHealth(
    [{ role: "user", content: "I step back" }],
    "The baton strikes you across the ribs. Pain blooms."
  );
  assert.equal(gate.assess, true);
  assert.equal(gate.reason, "scene_harm");
}

// --- calculateDamage ---
{
  const assessment: HarmAssessment = {
    harmed: true,
    severity: "moderate",
    body_part: "torso",
    injury: "bruised",
    cause: "baton strike",
    unconscious: false,
    confidence: 0.9,
  };
  const dmg = calculateDamage(assessment, {
    playerCombat: 20,
    npcCombat: 50,
    sceneSeed: "fixed-scene-seed",
  });
  assert.ok(dmg >= 16 && dmg <= 40, `moderate damage out of range: ${dmg}`);
}

{
  const lethal: HarmAssessment = {
    harmed: true,
    severity: "lethal",
    body_part: "torso",
    injury: "shot",
    cause: "center mass",
    unconscious: true,
    confidence: 1,
  };
  const dmg = calculateDamage(lethal, {
    playerCombat: 20,
    npcCombat: 60,
    sceneSeed: "gun",
  });
  assert.ok(dmg >= 85, `lethal should be devastating: ${dmg}`);
}

{
  assert.equal(
    calculateDamage(
      {
        harmed: false,
        severity: "none",
        body_part: null,
        injury: "ok",
        cause: "",
        unconscious: false,
        confidence: 1,
      },
      { playerCombat: 20, npcCombat: 40, sceneSeed: "x" }
    ),
    0
  );
}

// --- applyHealthDamage ---
{
  const state = {
    player: {
      id: "player",
      stats: { hp: 100, stamina: 80, pain: 0, combat: 20 },
      body: {
        head: "ok",
        torso: "ok",
        left_arm: "ok",
        right_arm: "ok",
        left_leg: "ok",
        right_leg: "ok",
      },
      conditions: [],
      conscious: true,
      alive: true,
    },
  };
  const applied = applyHealthDamage(
    state,
    {
      harmed: true,
      severity: "heavy",
      body_part: "torso",
      injury: "broken",
      cause: "rib crush",
      unconscious: false,
      confidence: 0.8,
    },
    40
  );
  assert.equal(applied.prior_hp, 100);
  assert.equal(applied.new_hp, 60);
  assert.equal(applied.died, false);
  const p = applied.state.player as {
    stats: { hp: number; pain: number };
    body: { torso: string };
    alive: boolean;
  };
  assert.equal(p.stats.hp, 60);
  assert.equal(p.body.torso, "broken");
  assert.ok(p.stats.pain >= 50);
  assert.equal(p.alive, true);
}

{
  const state = {
    player: {
      stats: { hp: 20, combat: 20 },
      body: { head: "ok", torso: "ok" },
      conscious: true,
      alive: true,
      conditions: [],
    },
  };
  const applied = applyHealthDamage(
    state,
    {
      harmed: true,
      severity: "lethal",
      body_part: "torso",
      injury: "shot",
      cause: "gunshot",
      unconscious: true,
      confidence: 1,
    },
    90
  );
  assert.equal(applied.new_hp, 0);
  assert.equal(applied.died, true);
  const p = applied.state.player as {
    alive: boolean;
    conscious: boolean;
    stats: { hp: number };
  };
  assert.equal(p.alive, false);
  assert.equal(p.conscious, false);
  assert.equal(p.stats.hp, 0);
}

// --- heuristicAssessment ---
{
  const a = heuristicAssessment(
    "I tackle him",
    "He shoots you in the chest. The bullet hits center mass."
  );
  assert.equal(a.harmed, true);
  assert.ok(a.severity === "lethal" || a.severity === "critical");
}

// --- rewrite preserves SCENE and patches hp ---
{
  const raw = `[SCENE]
The guard clubs your shoulder.

[WORLD]
STATE
{"player":{"stats":{"hp":100,"combat":20},"body":{"head":"ok","torso":"ok","left_arm":"ok","right_arm":"ok","left_leg":"ok","right_leg":"ok"},"alive":true,"conscious":true}}`;
  const state = extractStateJson(raw) as Record<string, unknown>;
  const applied = applyHealthDamage(
    state,
    {
      harmed: true,
      severity: "light",
      body_part: "left_arm",
      injury: "bruised",
      cause: "club",
      unconscious: false,
      confidence: 0.7,
    },
    10
  );
  const rewritten = rewriteWorldState(raw, applied.state);
  assert.match(rewritten, /The guard clubs your shoulder/);
  const next = extractStateJson(rewritten) as {
    player: { stats: { hp: number } };
  };
  assert.equal(next.player.stats.hp, 90);
}

console.log("test-health-tracker: ok");
