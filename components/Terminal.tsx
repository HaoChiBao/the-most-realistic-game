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

  const appendToEntry = useCallback((id: number, chunk: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, text: e.text + chunk } : e))
    );
  }, []);

  // Stream one engine response given the current history.
  const streamTurn = useCallback(async () => {
    setBusy(true);
    const engineId = addEntry("engine", "");
    let full = "";

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
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;

        // Hide the end sentinel from the player as it streams in.
        const display = full.includes(END_TOKEN)
          ? full.slice(0, full.indexOf(END_TOKEN))
          : full;
        setEntries((prev) =>
          prev.map((e) =>
            e.id === engineId ? { ...e, text: display.trimStart() } : e
          )
        );
        scrollToBottom();
      }

      const clean = full.replace(END_TOKEN, "").trim();
      historyRef.current.push({ role: "assistant", content: clean });

      if (full.includes(END_TOKEN)) {
        setEnded(true);
        addEntry("system", "— THE WORLD GOES DARK —");
      }
    } catch (err) {
      setEntries((prev) => prev.filter((e) => e.id !== engineId));
      addEntry("error", `SIGNAL LOST. ${String(err)}`);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [addEntry, scrollToBottom]);

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
