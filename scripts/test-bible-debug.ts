import assert from "node:assert/strict";
import {
  bibleJson,
  formatBibleGuide,
  formatBibleOverview,
  formatCommitAudit,
  formatHydrationAudit,
} from "../lib/bibleDebug";
import { normalizeWorldBible } from "../lib/worldBible";
import { buildDebugSections } from "../lib/debugDump";
import { executeDevCommand } from "../lib/devCommands";

const bible = normalizeWorldBible({
  world_type: "grounded",
  player_location: "alley",
  locations: [{ id: "alley", exits: ["street"] }],
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
      hp: 88,
      stamina: 70,
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
      id: "mills",
      name: "Mills",
      location: "alley",
      training: "professional",
      disposition: "hostile",
      violence: "fight",
    },
  ],
  laws: [{ id: "l1" }],
  threads: [],
  starting_plot: { id: "plot", phase: "setup" },
  clock: { turn: 3, time_of_day: "night" },
  heat: { level: 20, response: "none" },
});

{
  const overview = formatBibleOverview(bible);
  assert.ok(overview.includes("alley"), "overview has location");
  assert.ok(overview.includes("Mills"), "overview has cast");
  assert.ok(overview.includes("turn 3"), "overview has clock");
  assert.ok(formatBibleGuide().includes("/bible"), "guide mentions /bible");
  assert.equal((bibleJson(bible) as { player_location: string }).player_location, "alley");
}

{
  const audit = formatCommitAudit({
    at: "2026-07-31T00:00:00.000Z",
    source: "play",
    rejected: true,
    issueCount: 1,
    issues: [
      {
        code: "unknown_location",
        severity: "reject",
        message: 'player_location "void" not in locations[]',
      },
    ],
  });
  assert.ok(audit.includes("rejected: true"), "commit audit shows reject");
  assert.ok(audit.includes("unknown_location"), "commit audit shows code");
}

{
  const hyd = formatHydrationAudit({
    at: "2026-07-31T00:00:00.000Z",
    ok: false,
    failures: ["laws[] length 0 < required 2"],
    retried: true,
    softPatched: true,
  });
  assert.ok(hyd.includes("retried: true"), "hydrate audit retry");
  assert.ok(hyd.includes("laws[]"), "hydrate audit failure");
}

const history = [
  {
    role: "assistant" as const,
    content: `[SCENE]\nNight alley.\n[WORLD]\nSTATE\n${JSON.stringify(bibleJson(bible))}`,
  },
];

const commitAudit = {
  at: "2026-07-31T00:00:00.000Z",
  source: "play" as const,
  rejected: false,
  issueCount: 1,
  issues: [
    {
      code: "stats_clamp",
      severity: "repair" as const,
      message: "stats keys clamped to core set 0–100",
    },
  ],
};

const hydrateAudit = {
  at: "2026-07-31T00:00:00.000Z",
  ok: true,
  failures: [] as string[],
  retried: false,
  softPatched: false,
};

{
  const sections = buildDebugSections({
    history,
    meta: {
      seedCode: "48271560391234",
      turnCount: 1,
      assistantTurns: 1,
      ended: false,
      softEnded: false,
      endLabel: null,
      worldReady: true,
      bible,
      lastCommitAudit: commitAudit,
      lastHydrationAudit: hydrateAudit,
    },
    systemPrompt: null,
    openingInstruction: null,
  });
  assert.ok(sections.some((s) => s.id === "bible-overview"), "debug has bible overview");
  assert.ok(sections.some((s) => s.id === "bible-json"), "debug has bible json");
  assert.ok(sections.some((s) => s.id === "bible-validate"), "debug has validate");
  assert.ok(sections.some((s) => s.id === "bible-hydrate"), "debug has hydrate");
  assert.ok(sections.some((s) => s.id === "bible-guide"), "debug has guide");
  const overview = sections.find((s) => s.id === "bible-overview")!;
  assert.ok(overview.body.includes("Mills"), "panel overview uses live bible");
  const validate = sections.find((s) => s.id === "bible-validate")!;
  assert.ok(validate.body.includes("stats_clamp"), "panel shows commit audit");
}

{
  const ctx = {
    history,
    seedCode: "48271560391234",
    syncTimings: [],
    worldReady: true,
    ended: false,
    softEnded: false,
    endLabel: null,
    bible,
    lastCommitAudit: commitAudit,
    lastHydrationAudit: hydrateAudit,
  };
  const bibleCmd = executeDevCommand("/bible", ctx);
  assert.ok(bibleCmd.lines.join("\n").includes("WORLDBIBLE"), " /bible header");
  assert.ok(bibleCmd.lines.join("\n").includes("alley"), "/bible overview");

  const bibleJsonCmd = executeDevCommand("/bible json", ctx);
  assert.ok(bibleJsonCmd.lines.join("\n").includes("player_location"), "/bible json");

  const validateCmd = executeDevCommand("/validate", ctx);
  assert.ok(validateCmd.lines.join("\n").includes("stats_clamp"), "/validate");

  const hydrateCmd = executeDevCommand("/hydrate", ctx);
  assert.ok(hydrateCmd.lines.join("\n").includes("ok: true"), "/hydrate");

  const list = executeDevCommand("/commands", ctx);
  assert.ok(list.lines.join("\n").includes("/bible"), "commands lists /bible");
  assert.ok(list.lines.join("\n").includes("/validate"), "commands lists /validate");

  // /bible no longer aliases opening stories
  const opening = executeDevCommand("/opening", ctx);
  assert.ok(opening.lines.join("\n").includes("TURN 1"), "/opening still works");
  assert.ok(
    !executeDevCommand("/bible", ctx).lines.join("\n").includes("TURN 1 STORIES"),
    "/bible is not opening alias"
  );
}

console.log("bibleDebug tests passed");
