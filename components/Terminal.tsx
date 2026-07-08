"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

const MAX_INPUT = 140;
const END_TOKEN = "<END>";
// Typewriter reveal speed cap (characters per second). Text is never revealed
// faster than this, even when the model responds instantly.
const TYPE_CPS = 60;

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

type EntryType = "system" | "engine" | "player" | "error";

type Entry = {
  id: number;
  type: EntryType;
  text: string;
};

type Turn = { role: "user" | "assistant"; content: string };

export default function Terminal() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [booted, setBooted] = useState(false);
  const [ended, setEnded] = useState(false);

  const historyRef = useRef<Turn[]>([]);
  const idRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

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

  // Stream one engine response, revealing it at a capped typewriter speed.
  // The network fill and the on-screen reveal are decoupled: tokens land in a
  // buffer as fast as they arrive, while a rAF loop types them out steadily.
  const streamTurn = useCallback(async () => {
    setBusy(true);
    const engineId = addEntry("engine", "");

    let received = ""; // text ready to reveal (END sentinel already stripped)
    let sawEnd = false;
    let streamDone = false;
    let shown = 0;
    let acc = 0; // fractional character budget carried between frames
    let last = 0;
    let raf = 0;
    let finished = false;

    const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

    const finish = () => {
      if (finished) return;
      finished = true;
      const clean = received.trim();
      setEntryText(engineId, clean);
      historyRef.current.push({ role: "assistant", content: clean });
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
      let raw = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        if (raw.includes(END_TOKEN)) {
          sawEnd = true;
          received = raw.slice(0, raw.indexOf(END_TOKEN));
        } else {
          received = raw;
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
  }, [addEntry, scrollToBottom, setEntryText]);

  // Boot sequence, then generate the opening world.
  const boot = useCallback(async () => {
    for (const line of BOOT_LINES) {
      addEntry("system", line);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 90));
    }
    setBooted(true);
    await streamTurn();
  }, [addEntry, streamTurn]);

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

  const restart = useCallback(() => {
    if (busy) return;
    historyRef.current = [];
    setEntries([]);
    setInput("");
    setEnded(false);
    setBooted(false);
    startedRef.current = false;
    // Re-run boot on next tick.
    setTimeout(() => {
      startedRef.current = true;
      void boot();
    }, 0);
  }, [busy, boot]);

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
            <button className="restart" onClick={restart}>
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
            <span className={`count ${remaining <= 20 ? "warn" : ""}`}>
              {remaining} chars left
            </span>
            {!ended && (
              <>
                {"  "}
                <button
                  className="restart"
                  onClick={restart}
                  disabled={busy}
                  style={{ marginLeft: 12 }}
                >
                  new world
                </button>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
