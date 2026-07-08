"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

const MAX_INPUT = 90;
const END_TOKEN = "<END>";
// Typewriter reveal speed cap (characters per second). Text is never revealed
// faster than this, even when the model responds instantly.
const TYPE_CPS = 60;

// The engine replies in two layers: a visible [SCENE] block, then a hidden
// [WORLD] knowledge base. Only the scene is ever shown to the player.
function parseScene(raw: string): { scene: string; ended: boolean } {
  const sceneM = raw.match(/\[\s*SCENE\s*\]/i);
  const worldM = raw.match(/\[\s*WORLD\s*\]/i);
  const sceneIdx = sceneM ? (sceneM.index ?? -1) : -1;
  const worldIdx = worldM ? (worldM.index ?? -1) : -1;

  let text: string;
  if (sceneIdx !== -1) {
    const start = sceneIdx + sceneM![0].length;
    const end = worldIdx > sceneIdx ? worldIdx : raw.length;
    text = raw.slice(start, end);
  } else if (worldIdx !== -1) {
    text = raw.slice(0, worldIdx);
  } else {
    // No markers yet: hold off briefly so a partial "[SCENE]" label never
    // flashes on screen while it is still streaming in.
    text = raw.length > 24 ? raw : "";
  }

  let ended = false;
  const endIdx = text.indexOf(END_TOKEN);
  if (endIdx !== -1) {
    ended = true;
    text = text.slice(0, endIdx);
  }
  return { scene: text, ended };
}

// Rebuild the raw two-layer history message the engine expects from a stored
// seed's opening + hidden world.
function composeRaw(opening: string, world: string): string {
  return `[SCENE]\n${opening.trim()}\n\n[WORLD]\n${world.trim()}`;
}

const BOOT_LINES = [
  "REALITY ENGINE v3.1  //  DEEPSEEK CORE",
  "allocating world seed .......... OK",
  "spinning up hidden rules ....... OK",
  "seeding autonomous actors ...... OK",
  "",
  "a new world is generated for every session.",
  "type anything after the >> prompt. any action is valid.",
  "",
];

const BOOT_LINES_SEED = [
  "REALITY ENGINE v3.1  //  DEEPSEEK CORE",
  "resolving shared seed .......... OK",
  "restoring hidden world ......... OK",
  "waking autonomous actors ....... OK",
  "",
  "loading a world someone else discovered.",
  "your choices are your own from here.",
  "",
];

type EntryType = "system" | "engine" | "player" | "error";

type Entry = {
  id: number;
  type: EntryType;
  text: string;
};

type Turn = { role: "user" | "assistant"; content: string };

export default function Terminal({ seedCode }: { seedCode?: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [booted, setBooted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [worldReady, setWorldReady] = useState(false);
  const [sharing, setSharing] = useState(false);

  const historyRef = useRef<Turn[]>([]);
  const idRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);
  // The seed code of the world currently in play (loaded or after sharing), so
  // re-sharing the same world returns the same code instead of duplicating it.
  const seedRef = useRef<string | null>(null);

  const nextId = () => ++idRef.current;

  const scrollToBottom = useCallback(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [entries, scrollToBottom]);

  const addEntry = useCallback((type: EntryType, text: string) => {
    const id = nextId();
    setEntries((prev) => [...prev, { id, type, text }]);
    return id;
  }, []);

  const setEntryText = useCallback((id: number, text: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, text } : e)));
  }, []);

  const focusInput = useCallback(
    () => setTimeout(() => inputRef.current?.focus(), 0),
    []
  );

  // Type out already-known static text at the capped typewriter speed.
  const revealText = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        const id = addEntry("engine", "");
        let shown = 0;
        let acc = 0;
        let last = 0;
        const tick = (ts: number) => {
          if (!last) last = ts;
          acc += ((ts - last) / 1000) * TYPE_CPS;
          last = ts;
          const reveal = Math.floor(acc);
          if (reveal > 0) {
            acc -= reveal;
            shown = Math.min(text.length, shown + reveal);
            setEntryText(id, text.slice(0, shown));
            scrollToBottom();
          }
          if (shown >= text.length) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [addEntry, setEntryText, scrollToBottom]
  );

  // Stream one engine response, revealing it at a capped typewriter speed.
  // The network fill and the on-screen reveal are decoupled: tokens land in a
  // buffer as fast as they arrive, while a rAF loop types them out steadily.
  const streamTurn = useCallback(async () => {
    setBusy(true);
    const engineId = addEntry("engine", "");

    let received = ""; // visible scene text ready to reveal
    let rawFull = ""; // full raw output (scene + hidden world), kept for history
    let sawEnd = false;
    let streamDone = false;
    let shown = 0;
    let acc = 0; // fractional character budget carried between frames
    let last = 0;
    let raf = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      const cleanScene = received.trim();
      setEntryText(engineId, cleanScene);
      // Store the full response (including the hidden [WORLD] block) so the
      // engine keeps its ground truth on the next turn.
      const cleanRaw = rawFull.replace(END_TOKEN, "").trim();
      historyRef.current.push({
        role: "assistant",
        content: cleanRaw || cleanScene,
      });
      setWorldReady(true);
      if (sawEnd) {
        setEnded(true);
        addEntry("system", "— THE WORLD GOES DARK —");
      }
      setBusy(false);
      focusInput();
    };

    const tick = (ts: number) => {
      if (!last) last = ts;
      acc += ((ts - last) / 1000) * TYPE_CPS;
      last = ts;
      const reveal = Math.floor(acc);
      if (reveal > 0 && shown < received.length) {
        acc -= reveal;
        shown = Math.min(received.length, shown + reveal);
        setEntryText(engineId, received.slice(0, shown).trimStart());
        scrollToBottom();
      }
      if (streamDone && shown >= received.length) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: historyRef.current }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        setEntries((prev) => prev.filter((e) => e.id !== engineId));
        addEntry("error", detail || `ENGINE ERROR [${res.status}].`);
        setBusy(false);
        focusInput();
        return;
      }

      raf = requestAnimationFrame(tick);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawFull += decoder.decode(value, { stream: true });
        const parsed = parseScene(rawFull);
        received = parsed.scene;
        sawEnd = parsed.ended;
      }

      streamDone = true;
    } catch (err) {
      cancelAnimationFrame(raf);
      if (!finished) {
        setEntries((prev) => prev.filter((e) => e.id !== engineId));
        addEntry("error", `SIGNAL LOST. ${String(err)}`);
        setBusy(false);
        focusInput();
      }
    }
  }, [addEntry, scrollToBottom, setEntryText, focusInput]);

  // Load a shared world from its seed code instead of generating a new one.
  const loadSeed = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/seed/${code}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.opening || !data.world) {
          addEntry(
            "error",
            data.error || `NO WORLD FOUND FOR SEED ${code}. Generating a new one.`
          );
          setBusy(false);
          await streamTurn();
          return;
        }
        // Seed the engine's history with the stored world, then show the opening.
        historyRef.current.push({
          role: "assistant",
          content: composeRaw(data.opening, data.world),
        });
        seedRef.current = code;
        addEntry("system", `SEED ${code} LOADED.`);
        await revealText(String(data.opening).trim());
        setWorldReady(true);
        setBusy(false);
        focusInput();
      } catch (err) {
        addEntry("error", `COULD NOT LOAD SEED. ${String(err)}`);
        setBusy(false);
        await streamTurn();
      }
    },
    [addEntry, revealText, streamTurn, focusInput]
  );

  // Boot sequence, then either restore a shared seed or generate a new world.
  const boot = useCallback(async () => {
    const lines = seedCode ? BOOT_LINES_SEED : BOOT_LINES;
    for (const line of lines) {
      addEntry("system", line);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 90));
    }
    setBooted(true);
    if (seedCode) {
      await loadSeed(seedCode);
    } else {
      await streamTurn();
    }
  }, [addEntry, streamTurn, loadSeed, seedCode]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void boot();
  }, [boot]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const value = input.trim().slice(0, MAX_INPUT);
      if (!value || busy || ended) return;
      setInput("");
      addEntry("player", value);
      historyRef.current.push({ role: "user", content: value });
      await streamTurn();
    },
    [input, busy, ended, addEntry, streamTurn]
  );

  // Save the current world so others can play it, then copy a share link.
  const shareWorld = useCallback(async () => {
    if (busy || sharing || !worldReady) return;
    const first = historyRef.current[0];
    if (!first || first.role !== "assistant") return;

    const announce = (code: string) => {
      const link =
        typeof window !== "undefined"
          ? `${window.location.origin}/s/${code}`
          : `/s/${code}`;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(link).catch(() => {});
      }
      addEntry("system", `WORLD SAVED. SEED ${code}  //  LINK COPIED: ${link}`);
    };

    // Already shared/loaded this world: reuse the existing code.
    if (seedRef.current) {
      announce(seedRef.current);
      return;
    }

    setSharing(true);
    try {
      const res = await fetch("/api/seed/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: first.content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) {
        addEntry("error", data.error || "COULD NOT SAVE WORLD.");
      } else {
        seedRef.current = data.code;
        announce(data.code);
      }
    } catch (err) {
      addEntry("error", `COULD NOT SAVE WORLD. ${String(err)}`);
    } finally {
      setSharing(false);
    }
  }, [busy, sharing, worldReady, addEntry]);

  // A fresh random world is a clean navigation to the home route.
  const newWorld = useCallback(() => {
    if (busy) return;
    if (typeof window !== "undefined") window.location.assign("/");
  }, [busy]);

  const remaining = MAX_INPUT - input.length;
  const showCursor = busy || !booted;

  return (
    <div className="crt" onClick={() => inputRef.current?.focus()}>
      <div className="screen">
        <div className="log" ref={logRef}>
          {entries.map((entry) => (
            <div key={entry.id} className={`entry ${entry.type}`}>
              {entry.text}
              {showCursor &&
                entry.type === "engine" &&
                entry.id === idRef.current && <span className="cursor" />}
            </div>
          ))}
        </div>

        {ended ? (
          <div className="prompt">
            <span className="sigil">::</span>
            <button className="restart" onClick={newWorld}>
              [ generate a new world ]
            </button>
          </div>
        ) : (
          <form className="prompt" onSubmit={submit}>
            <span className="sigil">&gt;&gt;</span>
            <input
              ref={inputRef}
              value={input}
              maxLength={MAX_INPUT}
              disabled={busy || !booted}
              onChange={(e) => setInput(e.target.value)}
              placeholder={busy ? "the world is moving..." : "what do you do?"}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="game input"
            />
          </form>
        )}

        <div className="meta">
          <span>THE MOST REALISTIC GAME</span>
          <span className="controls">
            {!ended && (
              <span className={`count ${remaining <= 20 ? "warn" : ""}`}>
                {remaining} chars left
              </span>
            )}
            <button
              className="restart"
              onClick={shareWorld}
              disabled={busy || sharing || !worldReady}
              style={{ marginLeft: 12 }}
            >
              {sharing ? "saving..." : "share world"}
            </button>
            <a className="restart" href="/gallery" style={{ marginLeft: 12 }}>
              worlds
            </a>
            {!ended && (
              <button
                className="restart"
                onClick={newWorld}
                disabled={busy}
                style={{ marginLeft: 12 }}
              >
                new world
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
