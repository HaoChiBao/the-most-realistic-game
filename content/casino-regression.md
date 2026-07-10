# Casino playtest regression (YAN-259)

Manual / eval checklist for engine **v4.1**. Replaying a flooded-casino-style path must show interlocking systems — not isolated prompt rules.

## Setup

Start a new world. Prefer a grounded urban/casino-like seed, or force via play until you reach armed law + a climax event.

## Required outcomes

1. **Inventory consistency** — Items gained (lighter, note, key, radio, badge) remain queryable via “what do I have on me” across turns. STATE inventory matches SCENE.
2. **Early fight injury** — Grapple/punch leaves lasting body/stats change (ribs/torso pain, hp drop). Later actions reflect it.
3. **Capability ceilings** — “Use kung fu” / clearing multiple armed officers fails or costs dearly (shot, cuffed, dead). No invented skills in grounded worlds.
4. **Body gating** — Leg/arm injuries block sprint/aim/grapple as appropriate.
5. **Heat** — Shooting officers raises `heat.level` and response; street does not go quiet as a clean win.
6. **Soft end** — Starting-plot climax (e.g. explosion) may emit `<SOFT_END>` / STARTING PLOT RESOLVED without locking input.
7. **Continue** — After soft end, player can walk, enter a shop, or face manhunt aftermath. Hard `<END>` only on death / irreversible total loss.
8. **Location graph** — Movement uses exits; no teleport to undeclared places.
9. **On-the-fly characters** — New named NPCs get full stats sheets the turn they appear; sheets update after fights without the player asking.

## Sign-off

- [ ] Manual playtest passed against this list
- [ ] Engine version banner shows v4.1
- [ ] Local save resumes a soft-ended session with input unlocked

Blocks marking YAN-255 / M7 complete.
