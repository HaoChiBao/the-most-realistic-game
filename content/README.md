# Devlog / patch notes

Public patch notes live at `/patch-notes`.

## Source of truth

Edit [`content/devlog.json`](../content/devlog.json). Newest entries should be listed first (the page also sorts by `date` / `version`).

### Entry shape

```json
{
  "id": "unique-slug",
  "version": "0.4.1",
  "engine": "v4.1",
  "date": "2026-07-15",
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

## When to add an entry

- After shipping a milestone or player-facing feature
- After an engine version bump (`ENGINE_VERSION`)
- After notable ops/security changes that affect play

Keep bullets concrete. Prefer Linear IDs in `linear` over dumping ticket text into `changes`.
