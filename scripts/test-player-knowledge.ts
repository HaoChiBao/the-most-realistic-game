import assert from "node:assert/strict";
import {
  auditSceneKnowledge,
  buildKnowledgePromptBlock,
  knowledgeFromCharacter,
  normalizePlayerKnowledge,
  sceneMentionsName,
  sceneMentionsRole,
} from "../lib/playerKnowledge";
import { validateStateTransition } from "../lib/stateValidate";
import { buildGameMessages } from "../lib/gameMessages";

// normalize defaults
{
  const k = normalizePlayerKnowledge(undefined);
  assert.equal(k.seen, false);
  assert.equal(k.name_known, false);
  assert.equal(k.role_known, false);
  assert.equal(k.talked, false);
  assert.equal(k.backstory_known, false);
}

// legacy known_to_player → seen only (not name)
{
  const k = knowledgeFromCharacter({
    id: "jane",
    name: "Jane Doe",
    known_to_player: true,
  });
  assert.equal(k.seen, true);
  assert.equal(k.name_known, false);
}

// explicit player_knowledge wins
{
  const k = knowledgeFromCharacter({
    id: "jane",
    known_to_player: true,
    player_knowledge: { seen: true, name_known: true, talked: true },
  });
  assert.equal(k.name_known, true);
  assert.equal(k.role_known, false);
  assert.equal(k.talked, true);
}

// scene name / role detectors
assert.equal(sceneMentionsName("Jane Doe stands nearby.", "Jane Doe"), true);
assert.equal(sceneMentionsName("A woman stands nearby.", "Jane Doe"), false);
assert.equal(
  sceneMentionsRole(
    "She is the building superintendent.",
    "building superintendent"
  ),
  true
);
assert.equal(sceneMentionsRole("Someone watches you.", "building superintendent"), false);

// audit: premature name + role
{
  const leaks = auditSceneKnowledge(
    "Jane Doe is the building superintendent. She's cautious.",
    [
      {
        id: "jane",
        name: "Jane Doe",
        role: "building superintendent",
        player_knowledge: {
          seen: true,
          name_known: false,
          role_known: false,
          talked: false,
          backstory_known: false,
        },
      },
    ]
  );
  assert.ok(leaks.some((l) => l.code === "premature_name"));
  assert.ok(leaks.some((l) => l.code === "premature_role"));
}

// audit: earned name OK
{
  const leaks = auditSceneKnowledge("Jane Doe nods.", [
    {
      id: "jane",
      name: "Jane Doe",
      role: "building superintendent",
      player_knowledge: {
        seen: true,
        name_known: true,
        role_known: false,
        talked: true,
        backstory_known: false,
      },
    },
  ]);
  assert.equal(
    leaks.filter((l) => l.code === "premature_name").length,
    0,
    "name_known allows name"
  );
}

// validateStateTransition warns on premature name
{
  const prev = {
    world_type: "grounded",
    player_location: "room",
    locations: [{ id: "room", exits: ["hall"] }],
    player: {
      id: "player",
      alive: true,
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
    },
    characters: [
      {
        id: "jane",
        name: "Jane Doe",
        role: "building superintendent",
        location: "room",
        player_knowledge: {
          seen: true,
          name_known: false,
          role_known: false,
          talked: false,
          backstory_known: false,
        },
      },
    ],
    clock: { turn: 1 },
    heat: { level: 0, response: "none" },
  };
  const next = {
    ...prev,
    clock: { turn: 2 },
    characters: prev.characters,
  };
  const r = validateStateTransition(prev, next, {
    isPlayerTurn: true,
    scene:
      "Jane Doe stands nearby, watching you. She is the building superintendent.",
  });
  assert.ok(
    r.issues.some((i) => i.code === "knowledge_premature_name"),
    "warns premature name"
  );
  assert.ok(
    r.issues.some((i) => i.code === "knowledge_premature_role"),
    "warns premature role"
  );
  assert.equal(r.rejected, false, "knowledge leaks are warns not rejects");
}

// prompt block bans unknown name
{
  const block = buildKnowledgePromptBlock({
    player_location: "room",
    characters: [
      {
        id: "jane",
        name: "Jane Doe",
        role: "building superintendent",
        location: "room",
        player_knowledge: {
          seen: true,
          name_known: false,
          role_known: false,
          talked: false,
          backstory_known: false,
        },
      },
    ],
  });
  assert.ok(block.includes("[PLAYER KNOWLEDGE"));
  assert.ok(block.includes('BANNED in SCENE: proper name "Jane Doe"'));
  assert.ok(block.includes("building superintendent"));
}

// gameMessages injects knowledge gate on play turns
{
  const msgs = buildGameMessages([
    {
      role: "assistant",
      content: `[SCENE]\nA room.\n[WORLD]\nSTATE\n${JSON.stringify({
        clock: { turn: 1 },
        player_location: "room",
        characters: [
          {
            id: "jane",
            name: "Jane Doe",
            role: "building superintendent",
            location: "room",
            player_knowledge: {
              seen: false,
              name_known: false,
              role_known: false,
              talked: false,
              backstory_known: false,
            },
          },
        ],
      })}`,
    },
    { role: "user", content: "look around" },
  ]);
  const lastUser = msgs.filter((m) => m.role === "user").pop();
  assert.ok(
    lastUser?.content.includes("[PLAYER KNOWLEDGE"),
    "injects knowledge block"
  );
  assert.ok(
    lastUser?.content.includes("Jane Doe"),
    "lists true name for the model"
  );
  assert.ok(
    lastUser?.content.includes("name_known=false"),
    "shows name_known flag"
  );
}

console.log("playerKnowledge tests passed");
