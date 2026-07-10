# Seed-dial / laws playtest regression (M8)

Manual checklist for engine **v5.0**. Digits bias generation; stored bible remains exact on load.

## Setup

1. Start a **new world** on `/` (dial code is allocated before opening).
2. Open **debug** — confirm WorldSpec dials + constraints appear for the seed code.
3. Play until laws / NPCs / chill are testable. Share the world, then open `/s/CODE` in a fresh session.

## Required outcomes

1. **Dial influence** — Two different codes with the same digit-1 band feel related but distinct (place/isolation/law differ).
2. **laws[] seeded** — Debug STATE shows laws matching rule_density / law_count from WorldSpec.
3. **Unknown law can bite** — Breaking a local taboo costs heat/injury/NPC reaction before `known_to_player` is true; SCENE does not dump `true_rule`.
4. **Discovery** — After evidence/test, a law flips `known_to_player`; SCENE may then reference surface honestly.
5. **Threads as probes** — At least one thread links toward a law (test/enforce/break) without railroading.
6. **NPC rule carriers** — Named NPCs can care about / enforce laws; wrong person wrong time can be a law reaction.
7. **Chill still works** — In a high law-pressure dial world, "go to a coffee shop" / loiter does not force a raid every turn.
8. **No plot-from-digits** — Opening is not a genre label from dials; character-POV opening only.
9. **Share exactness** — `/s/CODE` loads the same turn-1 SCENE+WORLD as the creator (no regen from digits).
10. **Consistency** — Breaking a *known* law updates consequences and shows cost in SCENE.

## Sign-off

- [ ] Manual playtest passed
- [ ] Engine banner shows v5.0
- [ ] Debug WorldSpec + laws sections usable / copyable

Blocks marking M8 roll-up (YAN-263) complete.
