# Engineering roadmap — realism, consistency, persistence

Prioritized plan after the v6.0 architecture review. Goal: keep the
prompt-plus-hidden-STATE design, but move **fairness-critical truth** out of
LLM prose and into validated, slightly more deterministic code.

**North star:** the LLM proposes narration and STATE patches; the runtime owns
the WorldBible and rejects illegal transitions.

---

## Priority legend

| Tier | Meaning |
|------|---------|
| P0 | Correctness / trust bugs — ship first |
| P1 | Structural leverage — changes how the engine holds together |
| P2 | Realism depth — expands what feels simulated |
| P3 | Polish / ops — important but not core loop |

**Difficulty** is technical invasiveness, not calendar time:

- **S** — localized fix, existing tests extend easily
- **M** — new module + several call sites + regression suite
- **L** — cross-cutting runtime change (bible ownership, payload shape)

---

## Phase 0 — Stop the bleeding (P0)

Fix known false positives and persistence gaps before adding new systems.

### 0.1 Fix restraint / detention false positives — S ✅

**Problem:** `playerRestrained` treats any non-resolved condition with
`gates` including `"sprint"` as restrained (e.g. broken leg → detention timer).

**Files:** `lib/actionConsequence.ts`

**Shipped:** restrained only when `kind === "restraint"` **or** label matches
cuff/pin/restrain; mobility gates alone never count; SCENE cue remains secondary.

**Tests:** `scripts/test-action-consequence.ts`
- trauma + `gates: ["sprint"]` + wait spam → no detention injection
- real restraint condition + wait ×2 → detention fires

### 0.2 Fix lethal targeting — S ✅

**Problem:** `resolveLethalConsequence` fires from action text alone and falls
back to “the officer”, so civilian gun grabs can emit `SHOT BY POLICE`.

**Files:** `lib/actionConsequence.ts`, `lib/npcSelect.ts`

**Shipped:** lethal requires a present authority target (location / SCENE mention,
or armed-authority SCENE cue); no inventing “the officer”.

**Tests:**
- “grab his gun” with only civilian in scene → no lethal authority block
- “grab his gun” with officer in same location → lethal fires
- officer elsewhere in registry, civilian here → no false police ending

### 0.3 Location-scope combat escalation targets — S/M ✅

**Problem:** `pickCombatNpc` / `pickAuthorityNpc` can pick the highest-combat
NPC in the whole registry, not the person in the fight.

**Files:** `lib/npcSelect.ts`, `lib/combatContext.ts`, `lib/actionConsequence.ts`

**Shipped:** shared picker prefers `player_location`, then SCENE-mentioned /
hostile posture; global registry only as last resort (never for lethal /
first-assault authority).

**Tests:** `scripts/test-combat-context.ts` — two NPCs, wrong-room high-combat ignored

### 0.4 Enforce `engine_ver` on shared world load — S ✅

**Problem:** create stores `engine_ver`; load ignores it. Stale shares break quietly.

**Files:** `app/api/seed/[code]/route.ts`, `lib/seedLoad.ts`, Supabase `load_world`

**Shipped:** load API returns `engineVer`; mismatch / missing → HTTP 409 and no
opening/world payload. Terminal surfaces the API error via existing fail path.

**Tests:** `scripts/test-seed-load.ts`; manual share checklist item 11

### 0.5 Complete Supabase schema in repo — M ✅

**Problem:** only `create_world` migration present; `worlds` / `load_world` assumed.

**Files:** `supabase/migrations/20260708000000_worlds_schema.sql`, README

**Shipped:** canonical `public.worlds` + `create_world` + `load_world` (returns
`engine_ver`) + RLS/grants; README seed bootstrap section.

**Done when:** fresh Supabase project can apply migrations and share/load works

---

## Phase 1 — WorldBible runtime (P1)

Highest leverage. Demote raw chat JSON from “source of truth” to “transport”.

### 1.1 Typed WorldBible module — M

**New:** `lib/worldBible.ts` (types + empty/minimal factories)

**Shape (v1):** subset of current STATE schema with required fields:
- `world_type`, `player_location`, `locations[]`, `player`, `characters[]`
- `laws[]`, `heat`, `clock`, `conditions` (player + top-level)
- `threads[]`, `starting_plot`, `randomness`, `random_log[]`

**Work:**
- Parse/merge still uses `stateMerge`, but output is typed + normalized
- Terminal holds `bible: WorldBible` alongside history
- `getLastCanonicalState` becomes `getBible(history) | session.bible`

**Tests:** round-trip from sample STATE fixtures; bootstrap/hydration fixtures

### 1.2 Patch validation before commit — M

**New:** `lib/stateValidate.ts`

**Reject or repair illegal transitions:**
| Check | Severity |
|-------|----------|
| `clock.turn` must increase by ≥1 on player turns | reject / clamp |
| `player_location` must exist in `locations[]` | reject |
| Movement only along `exits` unless forced event flag | reject / warn |
| No teleport `alive: false → true` without resurrection flag | reject |
| Body part values ⊆ allowed enum | repair |
| Stats keys ⊆ core set; clamp 0–100 | repair |
| Named person in SCENE without `characters[]` id | warn → inject reminder next turn |
| `world_type === grounded` ⇒ no magic abilities invented mid-run | reject ability add |

**Integration:** `resolveCanonicalAssistantContent` validates after merge; on hard
fail keep previous bible and attach a server note for next turn.

**Tests:** `scripts/test-state-validate.ts` — one case per rule

### 1.3 Bible outside chat history (payload projection) — L

**Problem:** canonical STATE rewritten into assistant messages; stripWorld means
parse failure = amnesia; localStorage grows.

**Work:**
1. Persist `bible` in `SavedSession` (new save version)
2. Build LLM payload from: system + projected bible snapshot + recent SCENE-only turns + last N deltas
3. Keep `[WORLD]` in stream for model habit / debug, but **commit path** writes bible, not blind trust of text
4. On load: prefer saved bible; fall back to parse-from-history for old saves

**Files:** `lib/save.ts`, `lib/gameMessages.ts`, `components/Terminal.tsx`

**Tests:** save/load with bible; payload annotation shows projection; truncated WORLD cannot wipe player/cast

### 1.4 Hydration contract gate — M

**Problem:** Phase B can under-deliver laws/NPCs; world marked ready anyway.

**Work:** after `mergeHydrationIntoOpening`, assert contract:
- `law_count` from WorldSpec (or 2–4 default) satisfied
- ≥1 location with ≥1 exit
- player sheet complete (body + stats)
- 1–3 characters with persona fields (`training`, `disposition`, `violence`)
- `starting_plot` object present
- `world_type` matches dial decode

On fail: one automatic hydrate retry; then surface soft warning in debug + still play with bootstrap defaults.

**Files:** `lib/stateMerge.ts` / new `lib/hydrationContract.ts`, Terminal hydration

**Tests:** `scripts/test-opening-hydrate.ts` extended with contract pass/fail fixtures

---

## Phase 2 — Deterministic envelopes (P1)

Make fairness outcomes server-authored; model narrates inside the box.

### 2.1 Lower temperature on play turns — S

**Files:** `app/api/game/route.ts`, `lib/llm.ts`

| Phase | Suggested temp |
|-------|----------------|
| Opening present | 0.9–1.0 |
| Opening hydrate | 0.7–0.9 |
| Normal turns | 0.45–0.65 |
| Forced consequence turns | 0.3–0.5 |

Keep seeded rolls as the surprise channel.

**Tests:** config unit test for phase→temp mapping; manual feel check on opening variety

### 2.2 Server combat outcome resolver — M

**New:** `lib/combatResolve.ts`

**Input:** player action tags, player stats/body/conditions, target NPC sheet, heat, weapons  
**Output enum:** e.g. `npc_restrains` | `npc_ko` | `npc_lethal` | `player_wounds_npc` | `player_flees` | `stalemate_costly`

**Work:**
- Replace open-ended “NPC MUST win” prose with structured outcome + required STATE patches
- Model gets: outcome + allowed SCENE verbs + forbidden stalls
- Wire into `resolveActionConsequence` / combat escalation

**Tests:** untrained vs professional authority → restrain/lethal distribution; flee action escapes envelope

### 2.3 Backup / heat timeline clock — M

**Problem:** `backup_en_route` is prompt-honored; can stall.

**Work:**
- When heat.response becomes `backup_en_route`, set `heat.backup_eta_turn`
- Server injects forced arrival when `clock.turn >= backup_eta_turn`
- Same pattern for detention processing relocation

**Tests:** eta in past → injection; eta in future → no injection

### 2.4 Random roll outcome envelope — S/M

Today: server picks table/tier; model invents severity inside tier.  
Next: server also picks **outcome class** from a small seeded table
(`trip`, `witness`, `noise`, `nothing_useful`, …) so freak/hazard cannot invent plot railroads.

**Files:** `lib/randomness.ts`, prompt RANDOMNESS section

**Tests:** same seed+turn+salt → same class; freak hazard only when `fumble_eligible`

---

## Phase 3 — Character & world continuity (P1/P2)

### 3.1 SCENE name ↔ registry audit — M

**New:** light NER/heuristic in `lib/sceneCharacters.ts`
- Extract capitalized names / role nouns from SCENE
- Diff against `characters[]`
- Missing → next-turn injection: “add sheets for: …” **or** strip illegal proper names (prefer inject)

**Tests:** scene mentions “Officer Diaz” without sheet → flag

### 3.2 Memory compaction — S/M

**Work:**
- Cap `memory[]` per NPC (e.g. 12)
- Compact oldest into `memory_summary` string when over cap
- Delta merge must not re-explode full history every turn

**Tests:** append 20 memories → length ≤ cap + summary present

### 3.3 Disposition / trust monotonic rules — S

**Work:** violence against NPC ⇒ trust drop + disposition floor rules in validator
(attack → not friendly same turn without extraordinary flag).

### 3.4 Law / thread tick stubs — M

Not full sim — just server reminders:
- Active `heat` / unresolved `consequences` / `countdown_sec` get a structured tick note
- Condition `turns_active` incremented in bible commit path (not left to model)

**Files:** `lib/conditions.ts`, bible commit

**Tests:** active trauma not updated by model → runtime still increments `turns_active`

---

## Phase 4 — Persistence & product truth (P2)

### 4.1 Save format v2 — M

**Files:** `lib/save.ts`

```ts
{
  version: 2,
  engineVersion,
  seedCode,
  bible,          // canonical WorldBible
  history,        // SCENE-forward; WORLD optional/debug
  entries,
  openingWorld,
  // ...
}
```

Migrate v1→v2 by parsing last assistant STATE.

### 4.2 Share = dials + bible, clarify UX copy — S

Product language:
- **Share link** = exact turn-1 world snapshot
- **Digits alone** = physics dials, not regeneratable identical world

Update Terminal share/load strings + README design notes.

### 4.3 Optional server session persistence — L (later)

Only if cross-device resume matters. Otherwise keep localStorage + share snapshots.

### 4.4 Rewind persistence decision — S

Either:
- persist checkpoint stack in save v2, or
- document rewind as session-only and disable after reload

Pick one; don’t leave half-promised.

---

## Phase 5 — Depth systems (P2/P3)

Do **not** start these until Phases 0–2 are stable.

| System | Approach | Avoid |
|--------|----------|-------|
| Needs (hunger/sleep) | condition kinds + slow tick | full survival sim |
| Economy | scarcity dial → price/availability tags on vendors | global market sim |
| Reputation | derive from heat + trust aggregates | faction spreadsheet |
| Ecology/biomes | location tags + ambient tables | voxel terrain |

Each should plug into WorldBible validators + seeded tables, not new prompt essays alone.

---

## Phase 6 — Ops, tests, observability (P3, parallelizable)

### 6.1 Automated contract suite (CI)

Extend `npm test` with fixtures for:
- validate rules (1.2)
- combat resolve (2.2)
- hydration contract (1.4)
- lethal/restraint regressions (0.1–0.3)

Keep LLM live tests out of CI; use golden STATE JSON fixtures.

### 6.2 Manual playtest matrix

Update `content/seed-dial-regression.md` + `casino-regression.md`:
- authority fight (1 assault → cuff; gun grab → lethal)
- civilian fight (no false police end)
- chill exploration (no railroad)
- shared seed load across engine bump (expect refuse)

### 6.3 Debug panel: bible diff

Show last committed bible vs model-proposed delta + validation errors.
Makes prompt iteration vastly faster.

### 6.4 Rate limit / multi-instance

Move beyond in-memory IP map if production traffic matters (Upstash or similar).

---

## Suggested implementation order

```text
Week-shaped slices (effort, not calendar):

1) Phase 0.1 → 0.3 → 0.4     # bugfixes + share compat
2) Phase 2.1                   # cheap consistency win
3) Phase 1.1 → 1.2 → 1.4     # bible + validate + hydrate gate
4) Phase 2.2 → 2.3             # combat/heat envelopes
5) Phase 1.3                   # bible out of chat (hardest cut)
6) Phase 3.*                   # continuity
7) Phase 4.*                   # save v2 + copy
8) Phase 5 only if needed
```

**Do not** expand the system prompt further as the main fix. Prefer:
shorter prompt + stronger runtime envelopes.

---

## Success metrics

| Signal | Target |
|--------|--------|
| False `SHOT BY POLICE` on civilians | ~0 in targeted tests |
| Detention on injury-only wait | ~0 |
| Hydration missing laws/NPCs | retry or debug flag; measured in contract tests |
| World amnesia after truncated WORLD | impossible if bible persisted separately |
| Shared seed on engine bump | explicit refuse/migrate, never silent break |
| Combat stall (“ready to respond” loops) | already reduced; keep + outcome enum |
| Same seed+turn roll | unchanged reproducibility |

---

## Out of scope (for now)

- True multiplayer / shared live sessions
- Full procedural terrain / biome generator
- Replacing the LLM with a classical world sim
- Regenerating identical worlds from digits alone without a stored bible

---

## Working agreements

1. Every P0/P1 item ships with a `scripts/test-*.ts` case.
2. Bump `ENGINE_VERSION` when bible schema or commit rules change.
3. Add a `content/devlog.json` entry for player-visible behavior changes.
4. Prefer server enums + STATE patches over longer prompt bans.
5. When prompt and runtime disagree, **runtime wins**.
