"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  parseScene,
  stripControlTokens,
} from "@/lib/sceneParse";

const MAX_INPUT = 90;
const MAX_CHECKPOINTS = 20;
// Typewriter reveal speed cap (characters per second).
const TYPE_CPS = 60;

function composeRaw(opening: string, world: string): string {
  return `[SCENE]\n${opening.trim()}\n\n[WORLD]\n${world.trim()}`;
}

const BOOT_LINES_BASE = [
  "allocating world seed .......... OK",
  "spinning up story threads ...... OK",
  "seeding character personas ..... OK",
  "loading end clauses ............ OK",
  "",
  "actions have consequences. death is possible.",
  "type anything after the >> prompt.",
  "",
];

const BOOT_LINES_SEED_BASE = [
  "resolving shared seed .......... OK",
  "restoring hidden world ......... OK",
  "waking autonomous actors ....... OK",
  "",
  "loading a world someone else discovered.",
  "your choices are your own from here.",
  "",
];

type EntryType = "system" | "engine" | "player" | "error" | "diverge";

type Entry = {
  id: number;
  type: EntryType;
  text: string;
};

type Turn = { role: "user" | "assistant"; content: string };

type Checkpoint = {
  history: Turn[];
  entries: Entry[];
};

export default function Terminal({ seedCode }: { seedCode?: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [booted, setBooted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [endLabel, setEndLabel] = useState<string | null>(null);
  const [worldReady, setWorldReady] = useState(false);
  const [sharing, setSharing] = useState(false);

  const historyRef = useRef<Turn[]>([]);
  const checkpointsRef = useRef<Checkpoint[]>([]);
  const openingWorldRef = useRef<Turn | null>(null);
  const idRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);
  const seedRef = useRef<string | null>(seedCode ?? null);

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

  const saveCheckpoint = useCallback(() => {
    const cp: Checkpoint = {
      history: historyRef.current.map((t) => ({ ...t })),
      entries: entries.map((e) => ({ ...e })),
    };
    checkpointsRef.current.push(cp);
    if (checkpointsRef.current.length > MAX_CHECKPOINTS) {
      checkpointsRef.current.shift();
    }
  }, [entries]);

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

  const streamTurn = useCallback(async () => {
    setBusy(true);
    const engineId = addEntry("engine", "");

    let received = "";
    let rawFull = "";
    let sawEnd = false;
    let sawDiverge = false;
    let divergeShown = false;
    let label: string | null = null;
    let streamDone = false;
    let shown = 0;
    let acc = 0;
    let last = 0;
    let raf = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      const cleanScene = received.trim();
      setEntryText(engineId, cleanScene);

      const cleanRaw = stripControlTokens(rawFull);
      const assistantTurn: Turn = {
        role: "assistant",
        content: cleanRaw || cleanScene,
      };
      historyRef.current.push(assistantTurn);

      if (!openingWorldRef.current) {
        openingWorldRef.current = { ...assistantTurn };
      }

      setWorldReady(true);

      if (sawEnd) {
        setEndLabel(label);
        setEnded(true);
        addEntry("system", label ? `— ${label} —` : "— THE WORLD GOES DARK —");
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
        if (parsed.diverged) sawDiverge = true;
        if (parsed.endLabel) label = parsed.endLabel;
        if (parsed.diverged && !divergeShown) {
          divergeShown = true;
          addEntry("diverge", "YOUR STORY IS CHANGING");
        }
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
        const raw = composeRaw(data.opening, data.world);
        const turn: Turn = { role: "assistant", content: raw };
        historyRef.current.push(turn);
        openingWorldRef.current = { ...turn };
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

  const boot = useCallback(async () => {
    let engineLine = "REALITY ENGINE v3.3  //  ONLINE";
    try {
      const res = await fetch("/api/engine");
      if (res.ok) {
        const data = await res.json();
        const ver = data.version ?? "v3.3";
        const banner = data.banner ?? "ONLINE";
        engineLine = `REALITY ENGINE ${ver}  //  ${banner}`;
      }
    } catch {
      // keep default line
    }

    const lines = seedCode
      ? [engineLine, ...BOOT_LINES_SEED_BASE]
      : [engineLine, ...BOOT_LINES_BASE];
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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const value = input.trim().slice(0, MAX_INPUT);
      if (!value || busy || ended || !booted) return;
      saveCheckpoint();
      setInput("");
      addEntry("player", value);
      historyRef.current.push({ role: "user", content: value });
      await streamTurn();
    },
    [input, busy, ended, booted, addEntry, streamTurn, saveCheckpoint]
  );

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

  const newWorld = useCallback(() => {
    if (busy) return;
    if (typeof window !== "undefined") window.location.assign("/");
  }, [busy]);

  const retryWorld = useCallback(() => {
    if (busy) return;
    const code = seedRef.current;
    if (code) {
      window.location.assign(`/s/${code}`);
      return;
    }
    const opening = openingWorldRef.current;
    if (!opening) {
      newWorld();
      return;
    }
    historyRef.current = [];
    checkpointsRef.current = [];
    setEntries([]);
    setInput("");
    setEnded(false);
    setEndLabel(null);
    setWorldReady(false);
    setBooted(true);
    historyRef.current.push({ ...opening });
    const scene = parseScene(opening.content).scene;
    void revealText(scene).then(() => {
      setWorldReady(true);
      focusInput();
    });
  }, [busy, newWorld, revealText, focusInput]);

  const rewind = useCallback(() => {
    if (busy) return;
    const cp = checkpointsRef.current.pop();
    if (!cp) return;
    historyRef.current = cp.history.map((t) => ({ ...t }));
    setEntries(cp.entries.map((e) => ({ ...e })));
    idRef.current = cp.entries.reduce((m, e) => Math.max(m, e.id), 0);
    setEnded(false);
    setEndLabel(null);
    setInput("");
    focusInput();
  }, [busy, focusInput]);

  const remaining = MAX_INPUT - input.length;
  const showCursor = busy || !booted;
  const sendLocked = busy || !booted;
  const canRewind = checkpointsRef.current.length > 0;
  const placeholderText = !booted
    ? "loading the world... you can start typing"
    : busy
    ? "type your next move... it sends when the world settles"
    : "what do you do?";

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
          <div className="prompt end-prompt">
            <span className="sigil">::</span>
            <span className="end-actions">
              {canRewind && (
                <button className="restart" onClick={rewind} disabled={busy}>
                  [ rewind ]
                </button>
              )}
              <button className="restart" onClick={retryWorld} disabled={busy}>
                [ retry this world ]
              </button>
              <button className="restart" onClick={newWorld} disabled={busy}>
                [ new world ]
              </button>
            </span>
          </div>
        ) : (
          <form className="prompt" onSubmit={submit}>
            <span className="sigil">&gt;&gt;</span>
            <input
              ref={inputRef}
              value={input}
              maxLength={MAX_INPUT}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholderText}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="game input"
            />
            {sendLocked && <span className="send-lock">loading</span>}
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
            {ended && endLabel && (
              <span className="end-label">{endLabel}</span>
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
