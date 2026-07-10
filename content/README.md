# Devlog / patch notes

Public patch notes live at `/patch-notes`.

## Source of truth

Edit [`content/devlog.json`](devlog.json).

The page **groups entries by calendar day** (newest day at the top). Within each day, entries sort by **`significance`** (highest first), then version.

### Entry shape

```json
{
  "id": "unique-slug",
  "version": "0.5.6",
  "engine": "v5.5",
  "date": "2026-07-10",
  "significance": 82,
  "title": "Short headline",
  "summary": "One or two sentences for players.",
  "tags": ["feature", "engine"],
  "linear": ["YAN-248", "YAN-255"],
  "changes": [
    "Bullet players can scan",
    "Another shipped change"
  ]
}
```

### `significance` (required on new entries)

Integer **1–100**. Higher = more important **within the same `date`**.

Rough guide:

| Range | Use for |
|-------|---------|
| 85–100 | Major engine milestones, new core systems |
| 65–84 | Meaningful gameplay or generation changes |
| 40–64 | Security, persistence, notable UX |
| 1–39 | Small polish, meta, audio tweaks |

Same-day example order: engine v5.3 bundle (95) → seed dials M8 (90) → typing sound (35).

Multiple releases on one day stay as **separate entries** in JSON; the UI combines them under one day heading.

## When to add an entry

- After shipping a milestone or player-facing feature
- After an engine version bump (`ENGINE_VERSION`)
- After notable ops/security changes that affect play

Keep bullets concrete. Prefer Linear IDs in `linear` over dumping ticket text into `changes`.
