/**
 * In-game dev slash commands — read-only introspection without polluting LLM history.
 * Type /commands in the terminal for the full list.
 */

import { resolveActionConsequence } from "@/lib/actionConsequence";
import { extractCharactersFromState, formatCharactersOverview } from "@/lib/characterDebug";
import {
  extractConditionsFromState,
  formatConditionsOverview,
} from "@/lib/conditions";
import { extractStoriesFromState, formatStoriesOverview } from "@/lib/storyDebug";
import {
  extractRandomnessFromState,
  formatRollOverview,
} from "@/lib/randomness";
import { resolveRollForHistory } from "@/lib/rollContext";
import {
  decodeSeed,
  formatDialTableForDebug,
  formatWorldSpecForPrompt,
} from "@/lib/worldSpec";
import {
  extractSceneBlock,
  extractStateJson,
  extractWorldBlock,
} from "@/lib/stateParse";
import { formatSyncTimingTable, type SyncTimingRecord } from "@/lib/syncTiming";
import { ENGINE_VERSION } from "@/lib/systemPrompt";

export type DevCommandTurn = { role: "user" | "assistant"; content: string };

export type DevCommandContext = {
  history: DevCommandTurn[];
  seedCode: string | null;
  engineVersion?: string;
  syncTimings: SyncTimingRecord[];
  worldReady: boolean;
  ended: boolean;
  softEnded: boolean;
  endLabel: string | null;
};

export type DevCommandResult = {
  lines: string[];
  openDebugPanel?: boolean;
};

type CmdHandler = (args: string, ctx: DevCommandContext) => DevCommandResult;

type CmdDef = {
  name: string;
  aliases?: string[];
  blurb: string;
  category: string;
  needsWorld?: boolean;
  run: CmdHandler;
};

function pretty(value: unknown, maxChars = 3500): string {
  try {
    const s = JSON.stringify(value, null, 2);
    if (s.length <= maxChars) return s;
    return `${s.slice(0, maxChars)}\n… (truncated — use /debug for full dump)`;
  } catch {
    return String(value);
  }
}

function lastState(ctx: DevCommandContext): Record<string, unknown> | null {
  for (let i = ctx.history.length - 1; i >= 0; i--) {
    if (ctx.history[i].role !== "assistant") continue;
    const s = extractStateJson(ctx.history[i].content);
    if (s && typeof s === "object") return s as Record<string, unknown>;
  }
  return null;
}

function lastAssistantRaw(ctx: DevCommandContext): string | null {
  for (let i = ctx.history.length - 1; i >= 0; i--) {
    if (ctx.history[i].role === "assistant") return ctx.history[i].content;
  }
  return null;
}

function firstAssistantRaw(ctx: DevCommandContext): string | null {
  for (const t of ctx.history) {
    if (t.role === "assistant") return t.content;
  }
  return null;
}

function gameHistory(ctx: DevCommandContext): DevCommandTurn[] {
  return ctx.history.filter(
    (t) => !(t.role === "user" && t.content.trim().startsWith("/"))
  );
}

function header(title: string): string[] {
  return [`— ${title} —`, ""];
}

function needWorld(ctx: DevCommandContext): DevCommandResult | null {
  if (ctx.worldReady && lastState(ctx)) return null;
  return {
    lines: [
      ...header("NO WORLD YET"),
      "Start or load a world first, then try again.",
    ],
  };
}

const COMMANDS: CmdDef[] = [
  {
    name: "commands",
    aliases: ["help", "?"],
    category: "Meta",
    blurb: "List all dev slash commands",
    run: () => ({ lines: formatCommandList() }),
  },
  {
    name: "debug",
    aliases: ["panel", "dump"],
    category: "Meta",
    blurb: "Open the full debug panel (bottom-right)",
    run: () => ({
      lines: [
        ...header("DEBUG PANEL"),
        "Opening debug panel…",
        "Use the panel for full JSON, prompts, and LLM payload.",
      ],
      openDebugPanel: true,
    }),
  },
  {
    name: "session",
    aliases: ["meta"],
    category: "Session",
    blurb: "Turn count, seed, engine, end state",
    run: (_args, ctx) => {
      const users = ctx.history.filter((t) => t.role === "user").length;
      const assistants = ctx.history.filter((t) => t.role === "assistant").length;
      const devTurns = ctx.history.filter(
        (t) => t.role === "user" && t.content.trim().startsWith("/")
      ).length;
      return {
        lines: [
          ...header("SESSION"),
          `engine: ${ctx.engineVersion ?? ENGINE_VERSION}`,
          `seed: ${ctx.seedCode ?? "(none)"}`,
          `turns: ${users} player (${devTurns} dev cmds) · ${assistants} assistant`,
          `history messages: ${ctx.history.length}`,
          `world ready: ${ctx.worldReady}`,
          `ended: ${ctx.ended}${ctx.endLabel ? ` (${ctx.endLabel})` : ""}`,
          `soft ended: ${ctx.softEnded}`,
        ],
      };
    },
  },
  {
    name: "engine",
    category: "Session",
    blurb: "Engine version string",
    run: (_args, ctx) => ({
      lines: [
        ...header("ENGINE"),
        `version: ${ctx.engineVersion ?? ENGINE_VERSION}`,
        "boot line matches /api/engine on new world.",
      ],
    }),
  },
  {
    name: "scene",
    category: "Scene",
    blurb: "Latest visible [SCENE] text",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const raw = lastAssistantRaw(ctx);
      const scene = raw ? extractSceneBlock(raw) : null;
      return {
        lines: [
          ...header("SCENE (latest)"),
          scene?.trim() || "(empty — no [SCENE] parsed)",
        ],
      };
    },
  },
  {
    name: "world",
    category: "Scene",
    blurb: "Latest [WORLD] block (truncated)",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const raw = lastAssistantRaw(ctx);
      const world = raw ? extractWorldBlock(raw) : null;
      const text = world?.trim() || "(no [WORLD] block)";
      const cap = text.length > 2800 ? `${text.slice(0, 2800)}\n…` : text;
      return { lines: [...header("WORLD (raw, truncated)"), cap] };
    },
  },
  {
    name: "state",
    category: "State",
    blurb: "Full parsed STATE JSON (truncated)",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      return {
        lines: [...header("STATE JSON"), pretty(lastState(ctx))],
      };
    },
  },
  {
    name: "player",
    category: "State",
    blurb: "Player sheet from STATE",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const s = lastState(ctx);
      return {
        lines: [
          ...header("PLAYER"),
          pretty(s?.player ?? "(no player object)"),
        ],
      };
    },
  },
  {
    name: "traits",
    aliases: ["stats"],
    category: "State",
    blurb: "Player stats, body, traits, abilities",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const p = lastState(ctx)?.player as Record<string, unknown> | undefined;
      if (!p) {
        return { lines: [...header("TRAITS"), "(no player in STATE)"] };
      }
      return {
        lines: [
          ...header("TRAITS / STATS"),
          pretty({
            stats: p.stats,
            body: p.body,
            traits: p.traits,
            abilities: p.abilities,
            conscious: p.conscious,
            alive: p.alive,
            conditions: p.conditions,
          }),
        ],
      };
    },
  },
  {
    name: "inventory",
    aliases: ["inv", "items"],
    category: "State",
    blurb: "Player inventory",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const p = lastState(ctx)?.player as Record<string, unknown> | undefined;
      const inv = p?.inventory;
      return {
        lines: [
          ...header("INVENTORY"),
          Array.isArray(inv) && inv.length
            ? pretty(inv)
            : "(empty — no items in STATE)",
        ],
      };
    },
  },
  {
    name: "location",
    aliases: ["loc", "where"],
    category: "State",
    blurb: "Player location and exits",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const s = lastState(ctx);
      const locId = s?.player_location;
      const locs = Array.isArray(s?.locations) ? s!.locations : [];
      const here = locs.find(
        (l): l is Record<string, unknown> =>
          !!l && typeof l === "object" && String((l as Record<string, unknown>).id) === String(locId)
      );
      return {
        lines: [
          ...header("LOCATION"),
          `player_location: ${String(locId ?? "?")}`,
          "",
          "— current node —",
          pretty(here ?? "(id not found in locations[])"),
          "",
          `— graph (${locs.length} nodes) —`,
          pretty(locs),
        ],
      };
    },
  },
  {
    name: "npcs",
    aliases: ["characters", "chars", "cast"],
    category: "Characters",
    blurb: "NPC roster overview + optional filter by name/id",
    needsWorld: true,
    run: (args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const bundle = extractCharactersFromState(lastState(ctx));
      if (!bundle) {
        return { lines: [...header("NPCS"), "(could not parse characters[])"] };
      }
      let chars = bundle.characters;
      if (args) {
        const q = args.toLowerCase();
        chars = chars.filter(
          (c) =>
            c.id.toLowerCase().includes(q) ||
            (c.name?.toLowerCase().includes(q) ?? false) ||
            (c.role?.toLowerCase().includes(q) ?? false)
        );
      }
      const filtered = { ...bundle, characters: chars, count: chars.length };
      return {
        lines: [
          ...header(args ? `NPCS matching "${args}"` : "NPCS"),
          formatCharactersOverview(filtered),
          "",
          "— JSON —",
          pretty(chars),
        ],
      };
    },
  },
  {
    name: "story",
    aliases: ["plot"],
    category: "Story",
    blurb: "starting_plot, threads, active_track",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const bundle = extractStoriesFromState(lastState(ctx));
      return {
        lines: [
          ...header("STORY"),
          formatStoriesOverview(bundle, { label: "LATEST STATE" }),
        ],
      };
    },
  },
  {
    name: "threads",
    category: "Story",
    blurb: "threads[] only",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const s = lastState(ctx);
      return {
        lines: [
          ...header("THREADS"),
          pretty(s?.threads ?? []),
          "",
          `active_track: ${String(s?.active_track ?? "(not set)")}`,
        ],
      };
    },
  },
  {
    name: "timeline",
    category: "Story",
    blurb: "Off-screen timeline beats",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      return {
        lines: [...header("TIMELINE"), pretty(lastState(ctx)?.timeline ?? [])],
      };
    },
  },
  {
    name: "ambient",
    category: "Story",
    blurb: "ambient_hooks[]",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      return {
        lines: [
          ...header("AMBIENT"),
          pretty(lastState(ctx)?.ambient_hooks ?? []),
        ],
      };
    },
  },
  {
    name: "laws",
    aliases: ["rules"],
    category: "Story",
    blurb: "Discoverable laws[]",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      return {
        lines: [...header("LAWS"), pretty(lastState(ctx)?.laws ?? [])],
      };
    },
  },
  {
    name: "flags",
    aliases: ["fallout"],
    category: "Story",
    blurb: "consequences[] fallout flags in STATE (not server injection)",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const s = lastState(ctx);
      return {
        lines: [
          ...header("CONSEQUENCE FLAGS"),
          pretty(s?.consequences ?? []),
          "",
          "— end —",
          pretty({ end_clauses: s?.end_clauses, end_state: s?.end_state }),
        ],
      };
    },
  },
  {
    name: "conditions",
    aliases: ["cond", "afflictions"],
    category: "Combat",
    blurb: "Active conditions on player + NPCs",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const bundle = extractConditionsFromState(lastState(ctx));
      return {
        lines: [
          ...header("CONDITIONS"),
          formatConditionsOverview(
            bundle ?? { player: [], npc: [], all: [] }
          ),
        ],
      };
    },
  },
  {
    name: "heat",
    aliases: ["wanted"],
    category: "Combat",
    blurb: "heat / wanted status",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      return {
        lines: [...header("HEAT"), pretty(lastState(ctx)?.heat ?? {})],
      };
    },
  },
  {
    name: "next",
    aliases: ["consequence", "consequences", "inject", "combat"],
    category: "Combat",
    blurb: "Server action-consequence injection for your NEXT real turn",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const consequence = resolveActionConsequence(gameHistory(ctx));
      const roll = resolveRollForHistory(gameHistory(ctx), ctx.seedCode);
      const lines = [...header("NEXT TURN (server injections)")];
      if (consequence?.fired) {
        lines.push(`action: FIRED [${consequence.kind}]`);
        lines.push(pretty(consequence.debug ?? {}));
        lines.push("");
        lines.push(consequence.prompt_block);
      } else {
        lines.push("action consequence: (not active)");
      }
      lines.push("");
      if (roll) {
        lines.push("— random roll —");
        lines.push(formatRollOverview(roll));
      } else {
        lines.push("random roll: (none)");
      }
      return { lines };
    },
  },
  {
    name: "random",
    aliases: ["roll"],
    category: "Combat",
    blurb: "Hybrid randomness STATE + pending roll",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const roll = resolveRollForHistory(gameHistory(ctx), ctx.seedCode);
      const rand = extractRandomnessFromState(lastState(ctx));
      return {
        lines: [
          ...header("RANDOMNESS"),
          "— STATE —",
          pretty(rand ?? {}),
          "",
          "— next roll —",
          roll ? formatRollOverview(roll) : "(no roll queued)",
        ],
      };
    },
  },
  {
    name: "sync",
    aliases: ["timing"],
    category: "Session",
    blurb: "Scene vs STATE sync wait timings",
    run: (_args, ctx) => ({
      lines: [
        ...header("SYNC TIMING"),
        ctx.syncTimings.length
          ? formatSyncTimingTable(ctx.syncTimings)
          : "(no timings yet — play a turn)",
      ],
    }),
  },
  {
    name: "dials",
    aliases: ["worldspec", "spec"],
    category: "Session",
    blurb: "Seed dial breakdown (10 axes)",
    run: (_args, ctx) => {
      if (!ctx.seedCode) {
        return { lines: [...header("DIALS"), "(no seed — start a world)"] };
      }
      const spec = decodeSeed(ctx.seedCode);
      if (!spec) {
        return {
          lines: [...header("DIALS"), `invalid seed code: ${ctx.seedCode}`],
        };
      }
      return {
        lines: [
          ...header("WORLD SPEC / DIALS"),
          formatDialTableForDebug(spec),
          "",
          "— prompt block —",
          formatWorldSpecForPrompt(spec),
        ],
      };
    },
  },
  {
    name: "clock",
    aliases: ["time"],
    category: "State",
    blurb: "clock.time_of_day and turn counter",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const clock = lastState(ctx)?.clock;
      return {
        lines: [...header("CLOCK"), pretty(clock ?? "(no clock in STATE)")],
      };
    },
  },
  {
    name: "opening",
    aliases: ["gen", "bible"],
    category: "Story",
    blurb: "Turn-1 STATE story bundle (world at generation)",
    needsWorld: true,
    run: (_args, ctx) => {
      const block = needWorld(ctx);
      if (block) return block;
      const raw = firstAssistantRaw(ctx);
      const state = raw ? extractStateJson(raw) : null;
      const bundle = state ? extractStoriesFromState(state) : null;
      return {
        lines: [
          ...header("OPENING / TURN 1 STORIES"),
          formatStoriesOverview(bundle, {
            label: "TURN 1",
            turnHint: " — seeded at world creation",
          }),
        ],
      };
    },
  },
  {
    name: "history",
    aliases: ["turns", "actions"],
    category: "Session",
    blurb: "Recent player commands (dev cmds excluded from LLM)",
    run: (args, ctx) => {
      const n = Math.min(20, Math.max(1, parseInt(args, 10) || 8));
      const users = ctx.history.filter((t) => t.role === "user").slice(-n);
      const lines = [...header(`HISTORY (last ${users.length} player lines)`)];
      for (const t of users) {
        const dev = t.content.trim().startsWith("/") ? " [dev]" : "";
        lines.push(`>> ${t.content}${dev}`);
      }
      lines.push("");
      lines.push("(dev /commands are not sent to the LLM)");
      return { lines };
    },
  },
];

const BY_NAME = new Map<string, CmdDef>();
for (const cmd of COMMANDS) {
  BY_NAME.set(cmd.name, cmd);
  for (const a of cmd.aliases ?? []) BY_NAME.set(a, cmd);
}

export function isDevCommand(input: string): boolean {
  return input.trim().startsWith("/");
}

export function parseDevCommandInput(
  input: string
): { cmd: string; args: string } | null {
  const t = input.trim();
  if (!t.startsWith("/")) return null;
  const rest = t.slice(1).trim();
  if (!rest) return { cmd: "commands", args: "" };
  const sp = rest.search(/\s/);
  if (sp === -1) return { cmd: rest.toLowerCase(), args: "" };
  return {
    cmd: rest.slice(0, sp).toLowerCase(),
    args: rest.slice(sp + 1).trim(),
  };
}

export function formatCommandList(): string[] {
  const lines = [
    ...header("DEV COMMANDS"),
    "Slash commands — read-only, not sent to the engine.",
    "",
  ];
  const categories = [...new Set(COMMANDS.map((c) => c.category))];
  for (const cat of categories) {
    lines.push(`[ ${cat} ]`);
    for (const cmd of COMMANDS) {
      if (cmd.category !== cat) continue;
      const aliases =
        cmd.aliases && cmd.aliases.length
          ? `  (/${cmd.aliases.join(", /")})`
          : "";
      lines.push(`  /${cmd.name}${aliases}`);
      lines.push(`      ${cmd.blurb}`);
    }
    lines.push("");
  }
  lines.push("Examples: /npcs guard  /story  /next  /opening");
  return lines;
}

export function executeDevCommand(
  input: string,
  ctx: DevCommandContext
): DevCommandResult {
  const parsed = parseDevCommandInput(input);
  if (!parsed) {
    return { lines: [...header("DEV"), "invalid command input"] };
  }

  const def = BY_NAME.get(parsed.cmd);
  if (!def) {
    return {
      lines: [
        ...header("UNKNOWN COMMAND"),
        `/${parsed.cmd} is not recognized.`,
        "Type /commands for the list.",
      ],
    };
  }

  if (def.needsWorld && !ctx.worldReady) {
    return {
      lines: [
        ...header("NOT READY"),
        `/${def.name} needs an active world. Wait for the opening turn.`,
      ],
    };
  }

  return def.run(parsed.args, ctx);
}

export function listDevCommandNames(): string[] {
  return COMMANDS.map((c) => c.name);
}
