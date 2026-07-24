"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  coalesceSceneText,
  ensureAssistantHasScene,
  hasWorldMarker,
  isLeakedEngineMarkup,
  parseScene,
  stripControlTokens,
} from "@/lib/sceneParse";
import { resolveCanonicalAssistantContent, mergeHydrationIntoOpening } from "@/lib/stateMerge";
import { readGameStreamBody } from "@/lib/readGameStream";
import {
  buildSessionSnapshot,
  canRestoreSession,
  clearSession,
  loadSession,
  saveSession,
} from "@/lib/save";
import { MAX_HISTORY_MESSAGES } from "@/lib/gameMessages";
import DebugPanel from "@/components/DebugPanel";
import { makeSeedCode, parseSeedCode } from "@/lib/seed";
import {
  preloadTypingSound,
  startTypingSound,
  stopTypingSound,
  syncTypingSound,
} from "@/lib/typingSound";
import {
  formatSyncWaitSec,
  type SyncTimingRecord,
} from "@/lib/syncTiming";
import {
  executeDevCommand,
  isDevCommand,
  type DevCommandContext,
} from "@/lib/devCommands";

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
  "type anything after the >> prompt.  dev: /commands",
  "",
];

const BOOT_LINES_SEED_BASE = [
  "resolving shared seed .......... OK",
  "restoring hidden world ......... OK",
  "waking autonomous actors ....... OK",
  "",
  "loading a world someone else discovered.",
  "your choices are your own from here.",
  "dev introspection: /commands",
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
  const [worldSyncing, setWorldSyncing] = useState(false);
  const [worldHydrating, setWorldHydrating] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [lastSyncWaitSec, setLastSyncWaitSec] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [softEnded, setSoftEnded] = useState(false);
  const [endLabel, setEndLabel] = useState<string | null>(null);
  const [worldReady, setWorldReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugTick, setDebugTick] = useState(0);

  const historyRef = useRef<Turn[]>([]);
  const syncTimingsRef = useRef<SyncTimingRecord[]>([]);
  const checkpointsRef = useRef<Checkpoint[]>([]);
  const openingWorldRef = useRef<Turn | null>(null);
  const idRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);
  const runIdRef = useRef(0);
  const seedRef = useRef<string | null>(seedCode ?? null);
  const seedSavedRef = useRef(Boolean(seedCode));
  const entriesRef = useRef<Entry[]>([]);
  const endedRef = useRef(false);
  const softEndedRef = useRef(false);
  const endLabelRef = useRef<string | null>(null);
  const worldReadyRef = useRef(false);
  const sceneReadyRef = useRef(false);
  const worldHydratingRef = useRef(false);
  const hydrationPromiseRef = useRef<Promise<void> | null>(null);
  const engineVersionRef = useRef<string | undefined>(undefined);
  /** Prior-turn health mandate injected into the next /api/game call. */
  const pendingHealthBlockRef = useRef<string | null>(null);

  const nextId = () => ++idRef.current;

  const persistSession = useCallback(() => {
    if (historyRef.current.length === 0) return;
    saveSession(
      buildSessionSnapshot({
        seedCode: seedRef.current,
        history: historyRef.current,
        entries: entriesRef.current,
        nextEntryId: idRef.current,
        ended: endedRef.current,
        softEnded: softEndedRef.current,
        endLabel: endLabelRef.current,
        worldReady: worldReadyRef.current,
        openingWorld: openingWorldRef.current,
      })
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    endedRef.current = ended;
  }, [ended]);

  useEffect(() => {
    softEndedRef.current = softEnded;
  }, [softEnded]);

  useEffect(() => {
    endLabelRef.current = endLabel;
  }, [endLabel]);

  useEffect(() => {
    worldReadyRef.current = worldReady;
  }, [worldReady]);

  useEffect(() => {
    sceneReadyRef.current = sceneReady;
  }, [sceneReady]);

  useEffect(() => {
    worldHydratingRef.current = worldHydrating;
  }, [worldHydrating]);

  useEffect(() => {
    scrollToBottom();
  }, [entries, scrollToBottom]);

  useEffect(() => {
    const onUnload = () => persistSession();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [persistSession]);

  const addEntry = useCallback((type: EntryType, text: string) => {
    const id = nextId();
    setEntries((prev) => {
      const next = [...prev, { id, type, text }];
      entriesRef.current = next;
      return next;
    });
    return id;
  }, []);

  const setEntryText = useCallback((id: number, text: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, text } : e)));
  }, []);

  const focusInput = useCallback(
    () => setTimeout(() => inputRef.current?.focus(), 0),
    []
  );

  const devCommandContext = useCallback((): DevCommandContext => {
    return {
      history: historyRef.current.map((t) => ({ ...t })),
      seedCode: seedRef.current,
      engineVersion: engineVersionRef.current,
      syncTimings: syncTimingsRef.current,
      worldReady: worldReadyRef.current,
      ended: endedRef.current,
      softEnded: softEndedRef.current,
      endLabel: endLabelRef.current,
    };
  }, []);

  const runDevCommand = useCallback(
    (input: string) => {
      const result = executeDevCommand(input, devCommandContext());
      addEntry("player", input);
      addEntry("system", result.lines.join("\n"));
      if (result.openDebugPanel) {
        setDebugOpen(true);
        setDebugTick((t) => t + 1);
      }
      focusInput();
      setTimeout(() => persistSession(), 0);
    },
    [addEntry, devCommandContext, focusInput, persistSession]
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
        startTypingSound();
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
            stopTypingSound();
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [addEntry, setEntryText, scrollToBottom]
  );

  const waitForWorldReady = useCallback(async () => {
    if (worldReadyRef.current) return;
    const pending = hydrationPromiseRef.current;
    if (pending) {
      setWorldHydrating(true);
      await pending;
    }
  }, []);

  const hydrateWorld = useCallback(
    async (myRun: number, presentTypingMs: number, sceneChars: number) => {
      const hydrateStart = performance.now();
      setWorldHydrating(true);

      const finishHydration = (hydrateMs: number, ok: boolean) => {
        if (myRun !== runIdRef.current) return;
        setWorldHydrating(false);
        if (ok) {
          setWorldReady(true);
          worldReadyRef.current = true;
          const record: SyncTimingRecord = {
            turn: 0,
            userAction: null,
            sceneChars,
            typingMs: presentTypingMs,
            syncWaitMs: 0,
            hydrateMs: hydrateMs,
            totalMs: presentTypingMs,
            phase: "present",
          };
          syncTimingsRef.current = [...syncTimingsRef.current, record].slice(-40);
          setTimeout(() => persistSession(), 0);
        }
        hydrationPromiseRef.current = null;
      };

      try {
        const res = await fetch("/api/game", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history: historyRef.current.slice(-MAX_HISTORY_MESSAGES),
            seedCode: seedRef.current,
            openingPhase: "hydrate",
          }),
        });

        if (!res.ok || !res.body) {
          if (myRun !== runIdRef.current) return;
          const detail = await res.text().catch(() => "");
          addEntry(
            "error",
            detail || `HYDRATION FAILED [${res.status}]. Try your action again.`
          );
          finishHydration(Math.round(performance.now() - hydrateStart), false);
          return;
        }

        const raw = await readGameStreamBody(res.body);
        if (myRun !== runIdRef.current) return;

        const opening = historyRef.current[0];
        if (!opening || opening.role !== "assistant") {
          finishHydration(Math.round(performance.now() - hydrateStart), false);
          return;
        }

        const hydrated = mergeHydrationIntoOpening(
          opening.content,
          stripControlTokens(raw)
        );
        historyRef.current[0] = { role: "assistant", content: hydrated };
        openingWorldRef.current = { ...historyRef.current[0] };
        finishHydration(Math.round(performance.now() - hydrateStart), true);
      } catch (err) {
        if (myRun !== runIdRef.current) return;
        addEntry("error", `HYDRATION LOST. ${String(err)}`);
        finishHydration(Math.round(performance.now() - hydrateStart), false);
      }
    },
    [addEntry, persistSession]
  );

  const startHydration = useCallback(
    (myRun: number, presentTypingMs: number, sceneChars: number) => {
      if (hydrationPromiseRef.current) return;
      const promise = hydrateWorld(myRun, presentTypingMs, sceneChars);
      hydrationPromiseRef.current = promise;
      void promise;
    },
    [hydrateWorld]
  );

  const streamOpeningPresent = useCallback(async () => {
    const myRun = runIdRef.current;
    setBusy(true);
    setSceneReady(false);
    sceneReadyRef.current = false;
    setWorldReady(false);
    worldReadyRef.current = false;
    setWorldSyncing(false);
    setWorldHydrating(false);
    setLastSyncWaitSec(null);
    hydrationPromiseRef.current = null;

    const engineId = addEntry("engine", "");
    const turnStart = performance.now();
    let sceneRevealedAt: number | null = null;
    let inputUnlocked = false;

    let received = "";
    let rawFull = "";
    let streamDone = false;
    let shown = 0;
    let acc = 0;
    let last = 0;
    let raf = 0;
    let finished = false;
    let lockedScene: string | null = null;

    const unlockInput = (ts: number) => {
      if (inputUnlocked || myRun !== runIdRef.current) return;
      inputUnlocked = true;
      if (sceneRevealedAt === null) sceneRevealedAt = ts;
      setSceneReady(true);
      sceneReadyRef.current = true;
      setBusy(false);
      syncTypingSound(false);
      focusInput();
    };

    const finishPresent = () => {
      if (finished || myRun !== runIdRef.current) return;
      finished = true;
      const finishedAt = performance.now();
      const cleanScene = coalesceSceneText(received);
      if (sceneRevealedAt === null && cleanScene.length > 0) {
        sceneRevealedAt = finishedAt;
      }
      if (!inputUnlocked) unlockInput(finishedAt);

      setEntryText(engineId, cleanScene);

      let cleanRaw = ensureAssistantHasScene(stripControlTokens(rawFull));
      const canonicalContent = resolveCanonicalAssistantContent(
        historyRef.current,
        cleanRaw || cleanScene
      );
      const assistantTurn: Turn = {
        role: "assistant",
        content: canonicalContent,
      };
      historyRef.current.push(assistantTurn);
      openingWorldRef.current = { ...assistantTurn };

      const typingMs = Math.round((sceneRevealedAt ?? finishedAt) - turnStart);
      startHydration(myRun, typingMs, cleanScene.length);
      setTimeout(() => persistSession(), 0);
    };

    const tick = (ts: number) => {
      if (!last) last = ts;
      acc += ((ts - last) / 1000) * TYPE_CPS;
      last = ts;
      const reveal = Math.floor(acc);
      const hasMoreToShow = shown < received.length;

      if (reveal > 0 && hasMoreToShow) {
        acc -= reveal;
        shown = Math.min(received.length, shown + reveal);
        setEntryText(engineId, received.slice(0, shown));
        scrollToBottom();
      }

      syncTypingSound(hasMoreToShow && !finished);

      const sceneFullyShown =
        received.length > 0 && shown >= received.length;
      if (sceneFullyShown) {
        unlockInput(ts);
      }

      if (streamDone && (received.length === 0 || shown >= received.length)) {
        finishPresent();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const needsSceneRetry = (raw: string) => {
      const scene = parseScene(raw).scene.trim();
      return (
        hasWorldMarker(raw) && (!scene || isLeakedEngineMarkup(scene))
      );
    };

    const resetStreamState = () => {
      rawFull = "";
      received = "";
      lockedScene = null;
      streamDone = false;
      shown = 0;
      acc = 0;
      last = 0;
      sceneRevealedAt = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) resetStreamState();

        const res = await fetch("/api/game", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history: historyRef.current.slice(-MAX_HISTORY_MESSAGES),
            seedCode: seedRef.current,
            openingPhase: "present",
          }),
        });

        if (!res.ok || !res.body) {
          if (myRun !== runIdRef.current) return;
          syncTypingSound(false);
          const detail = await res.text().catch(() => "");
          setEntries((prev) => prev.filter((e) => e.id !== engineId));
          addEntry("error", detail || `ENGINE ERROR [${res.status}].`);
          setBusy(false);
          focusInput();
          return;
        }

        if (!raf) raf = requestAnimationFrame(tick);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawFull += decoder.decode(value, { stream: true });
          if (lockedScene === null && hasWorldMarker(rawFull)) {
            lockedScene = parseScene(rawFull).scene;
          }
          const parsed = parseScene(rawFull);
          received = lockedScene ?? parsed.scene;
          if (shown > received.length) shown = received.length;
        }

        if (!needsSceneRetry(rawFull) || attempt === 1) break;
      }

      streamDone = true;
    } catch (err) {
      cancelAnimationFrame(raf);
      syncTypingSound(false);
      if (!finished && myRun === runIdRef.current) {
        setEntries((prev) => prev.filter((e) => e.id !== engineId));
        addEntry("error", `SIGNAL LOST. ${String(err)}`);
        setBusy(false);
        focusInput();
      }
    }
  }, [
    addEntry,
    scrollToBottom,
    setEntryText,
    focusInput,
    persistSession,
    startHydration,
  ]);

  const streamTurn = useCallback(async () => {
    const myRun = runIdRef.current;
    setBusy(true);
    setWorldSyncing(false);
    setLastSyncWaitSec(null);
    const engineId = addEntry("engine", "");

    const turnStart = performance.now();
    const turnNumber = historyRef.current.filter((t) => t.role === "user").length;
    let lastUserAction: string | null = null;
    for (let i = historyRef.current.length - 1; i >= 0; i--) {
      if (historyRef.current[i].role === "user") {
        lastUserAction = historyRef.current[i].content;
        break;
      }
    }
    let syncGapStart: number | null = null;
    let sceneRevealedAt: number | null = null;

    let received = "";
    let rawFull = "";
    let sawEnd = false;
    let sawSoftEnd = false;
    let sawDiverge = false;
    let divergeShown = false;
    let label: string | null = null;
    let streamDone = false;
    let shown = 0;
    let acc = 0;
    let last = 0;
    let raf = 0;
    let finished = false;
    let syncingShown = false;
    let lockedScene: string | null = null;

    const setSyncing = (on: boolean) => {
      if (syncingShown === on) return;
      syncingShown = on;
      if (myRun === runIdRef.current) setWorldSyncing(on);
    };

    let finalizing = false;
    const finish = () => {
      if (finished || finalizing || myRun !== runIdRef.current) return;
      finalizing = true;

      void (async () => {
        const finishedAt = performance.now();
        const cleanScene = coalesceSceneText(received);
        if (sceneRevealedAt === null && cleanScene.length > 0) {
          sceneRevealedAt = finishedAt;
        }
        const record: SyncTimingRecord = {
          turn: turnNumber,
          userAction: lastUserAction,
          sceneChars: cleanScene.length,
          typingMs: Math.round((sceneRevealedAt ?? finishedAt) - turnStart),
          syncWaitMs: Math.round(
            syncGapStart !== null ? finishedAt - syncGapStart : 0
          ),
          totalMs: Math.round(finishedAt - turnStart),
          phase: "play",
        };
        syncTimingsRef.current = [...syncTimingsRef.current, record].slice(-40);
        if (record.syncWaitMs > 0) {
          setLastSyncWaitSec(formatSyncWaitSec(record.syncWaitMs));
        }
        syncTypingSound(false);
        setSyncing(false);
        setEntryText(engineId, cleanScene);

        let cleanRaw = ensureAssistantHasScene(stripControlTokens(rawFull));
        let canonicalContent = resolveCanonicalAssistantContent(
          historyRef.current,
          cleanRaw || cleanScene
        );

        // Dedicated lightweight HP pass — owns damage numbers on harm turns.
        try {
          const healthRes = await fetch("/api/health", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              history: historyRef.current.slice(-MAX_HISTORY_MESSAGES),
              assistantContent: canonicalContent,
            }),
          });
          if (healthRes.ok) {
            const healthJson = (await healthRes.json()) as {
              content?: string;
              result?: {
                assessed?: boolean;
                skipped?: boolean;
                damage?: number;
                prior_hp?: number;
                new_hp?: number;
                died?: boolean;
                prompt_block?: string | null;
              };
            };
            if (typeof healthJson.content === "string" && healthJson.content) {
              canonicalContent = healthJson.content;
            }
            const hr = healthJson.result;
            if (hr?.prompt_block) {
              pendingHealthBlockRef.current = hr.prompt_block;
            } else {
              pendingHealthBlockRef.current = null;
            }
            if (
              hr?.assessed &&
              !hr.skipped &&
              typeof hr.damage === "number" &&
              hr.damage > 0 &&
              myRun === runIdRef.current
            ) {
              addEntry(
                "system",
                `vitality ${hr.prior_hp ?? "?"} → ${hr.new_hp ?? "?"} (−${hr.damage})`
              );
            }
            if (hr?.died) {
              sawEnd = true;
              if (!label) label = "DEAD";
              const endedParse = parseScene(canonicalContent);
              if (endedParse.ended) sawEnd = true;
            }
          }
        } catch {
          // Non-fatal — narrative STATE still stands if tracker fails.
        }

        if (myRun !== runIdRef.current) return;
        finished = true;

        const assistantTurn: Turn = {
          role: "assistant",
          content: canonicalContent,
        };
        historyRef.current.push(assistantTurn);

        if (!openingWorldRef.current) {
          openingWorldRef.current = { ...assistantTurn };
        }

        setWorldReady(true);

        if (sawEnd) {
          setEndLabel(label);
          setEnded(true);
          setSoftEnded(false);
          endLabelRef.current = label;
          endedRef.current = true;
          softEndedRef.current = false;
          addEntry("system", label ? `— ${label} —` : "— THE WORLD GOES DARK —");
        } else if (sawSoftEnd) {
          setEndLabel(label);
          setSoftEnded(true);
          endLabelRef.current = label;
          softEndedRef.current = true;
          addEntry(
            "system",
            label
              ? `— ${label} —  //  THE WORLD CONTINUES`
              : "— A CHAPTER CLOSES —  //  THE WORLD CONTINUES"
          );
        }

        setBusy(false);
        focusInput();
        setTimeout(() => persistSession(), 0);
      })();
    };

    const tick = (ts: number) => {
      if (!last) last = ts;
      acc += ((ts - last) / 1000) * TYPE_CPS;
      last = ts;
      const reveal = Math.floor(acc);
      const hasMoreToShow = shown < received.length;

      if (reveal > 0 && hasMoreToShow) {
        acc -= reveal;
        shown = Math.min(received.length, shown + reveal);
        setSyncing(false);
        setEntryText(engineId, received.slice(0, shown));
        scrollToBottom();
      }

      // Sound tracks visible reveal only — not hidden [WORLD] / STATE streaming.
      syncTypingSound(hasMoreToShow && !finished);

      const sceneFullyShown =
        received.length > 0 && shown >= received.length;
      if (sceneFullyShown && sceneRevealedAt === null) {
        sceneRevealedAt = ts;
      }
      if (sceneFullyShown && !streamDone && syncGapStart === null) {
        syncGapStart = ts;
      }

      if (!streamDone && sceneFullyShown) {
        setSyncing(true);
      } else if (!sceneFullyShown) {
        setSyncing(false);
      }

      if (streamDone && (received.length === 0 || shown >= received.length)) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const needsSceneRetry = (raw: string) => {
      const scene = parseScene(raw).scene.trim();
      return (
        hasWorldMarker(raw) && (!scene || isLeakedEngineMarkup(scene))
      );
    };

    const resetStreamState = () => {
      rawFull = "";
      received = "";
      lockedScene = null;
      sawEnd = false;
      sawSoftEnd = false;
      sawDiverge = false;
      divergeShown = false;
      label = null;
      streamDone = false;
      shown = 0;
      acc = 0;
      last = 0;
      syncGapStart = null;
      sceneRevealedAt = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    try {
      // Capture once so a scene-retry does not drop the prior-turn health mandate.
      const healthBlock = pendingHealthBlockRef.current;
      pendingHealthBlockRef.current = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) resetStreamState();

        const res = await fetch("/api/game", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history: historyRef.current.slice(-MAX_HISTORY_MESSAGES),
            seedCode: seedRef.current,
            healthBlock,
          }),
        });

        if (!res.ok || !res.body) {
          if (myRun !== runIdRef.current) return;
          // Restore notice so a retry can still inform the model.
          if (healthBlock) pendingHealthBlockRef.current = healthBlock;
          syncTypingSound(false);
          setSyncing(false);
          const detail = await res.text().catch(() => "");
          setEntries((prev) => prev.filter((e) => e.id !== engineId));
          addEntry("error", detail || `ENGINE ERROR [${res.status}].`);
          setBusy(false);
          focusInput();
          return;
        }

        if (!raf) raf = requestAnimationFrame(tick);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawFull += decoder.decode(value, { stream: true });
          if (lockedScene === null && hasWorldMarker(rawFull)) {
            lockedScene = parseScene(rawFull).scene;
          }
          const parsed = parseScene(rawFull);
          received = lockedScene ?? parsed.scene;
          if (shown > received.length) shown = received.length;
          sawEnd = parsed.ended;
          sawSoftEnd = parsed.softEnded;
          if (parsed.diverged) sawDiverge = true;
          if (parsed.endLabel) label = parsed.endLabel;
          if (parsed.diverged && !divergeShown) {
            divergeShown = true;
            addEntry("diverge", "YOUR STORY IS CHANGING");
          }
        }

        if (!needsSceneRetry(rawFull) || attempt === 1) break;
      }

      streamDone = true;
    } catch (err) {
      cancelAnimationFrame(raf);
      syncTypingSound(false);
      setSyncing(false);
      if (!finished && myRun === runIdRef.current) {
        setEntries((prev) => prev.filter((e) => e.id !== engineId));
        addEntry("error", `SIGNAL LOST. ${String(err)}`);
        setBusy(false);
        focusInput();
      }
    }
  }, [addEntry, scrollToBottom, setEntryText, focusInput, persistSession]);

  const loadSeed = useCallback(
    async (code: string) => {
      const myRun = runIdRef.current;
      setBusy(true);
      try {
        const res = await fetch(`/api/seed/${code}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.opening || !data.world) {
          if (myRun !== runIdRef.current) return;
          addEntry(
            "error",
            data.error || `NO WORLD FOUND FOR SEED ${code}. Generating a new one.`
          );
          setBusy(false);
          await streamTurn();
          return;
        }
        if (myRun !== runIdRef.current) return;
        const raw = composeRaw(data.opening, data.world);
        const turn: Turn = { role: "assistant", content: raw };
        historyRef.current.push(turn);
        openingWorldRef.current = { ...turn };
        seedRef.current = code;
        addEntry("system", `SEED ${code} LOADED.`);
        await revealText(String(data.opening).trim());
        setSceneReady(true);
        sceneReadyRef.current = true;
        setWorldReady(true);
        worldReadyRef.current = true;
        setBusy(false);
        focusInput();
        persistSession();
      } catch (err) {
        if (myRun !== runIdRef.current) return;
        addEntry("error", `COULD NOT LOAD SEED. ${String(err)}`);
        setBusy(false);
        await streamTurn();
      }
    },
    [addEntry, revealText, streamTurn, focusInput, persistSession]
  );

  const resetForNewWorld = useCallback(() => {
    runIdRef.current += 1;
    stopTypingSound();
    clearSession();
    historyRef.current = [];
    syncTimingsRef.current = [];
    checkpointsRef.current = [];
    pendingHealthBlockRef.current = null;
    openingWorldRef.current = null;
    idRef.current = 0;
    seedRef.current = null;
    seedSavedRef.current = false;
    entriesRef.current = [];
    endedRef.current = false;
    softEndedRef.current = false;
    endLabelRef.current = null;
    worldReadyRef.current = false;
    setEntries([]);
    setInput("");
    setBusy(false);
    setWorldSyncing(false);
    setWorldHydrating(false);
    setSceneReady(false);
    sceneReadyRef.current = false;
    hydrationPromiseRef.current = null;
    setLastSyncWaitSec(null);
    setBooted(false);
    setEnded(false);
    setSoftEnded(false);
    setEndLabel(null);
    setWorldReady(false);
    setSharing(false);
    setDebugOpen(false);
  }, []);

  const fetchEngineVersion = useCallback(async () => {
    try {
      const res = await fetch("/api/engine");
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.version === "string") {
        engineVersionRef.current = data.version;
      }
    } catch {
      // ignore
    }
  }, []);

  const beginFreshWorld = useCallback(async () => {
    const myRun = runIdRef.current;
    const stillActive = () => myRun === runIdRef.current;

    let engineLine = "REALITY ENGINE v5.5  //  ONLINE";
    try {
      const res = await fetch("/api/engine");
      if (res.ok) {
        const data = await res.json();
        const ver = data.version ?? "v5.5";
        const banner = data.banner ?? "ONLINE";
        if (typeof data.version === "string") {
          engineVersionRef.current = data.version;
        }
        engineLine = `REALITY ENGINE ${ver}  //  ${banner}`;
      }
    } catch {
      // keep default line
    }

    if (!stillActive()) return;

    const lines = seedCode
      ? [engineLine, ...BOOT_LINES_SEED_BASE]
      : [engineLine, ...BOOT_LINES_BASE];
    for (const line of lines) {
      if (!stillActive()) return;
      addEntry("system", line);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 90));
    }
    if (!stillActive()) return;
    setBooted(true);
    if (seedCode) {
      seedRef.current = seedCode;
      seedSavedRef.current = true;
      await loadSeed(seedCode);
    } else {
      if (!seedRef.current) {
        seedRef.current = makeSeedCode();
        seedSavedRef.current = false;
      }
      await streamOpeningPresent();
    }
  }, [addEntry, streamOpeningPresent, loadSeed, seedCode, fetchEngineVersion]);

  const boot = useCallback(async () => {
    void fetchEngineVersion();
    const saved = loadSession();
    if (saved && canRestoreSession(saved, seedCode)) {
      historyRef.current = saved.history.map((t) => ({ ...t }));
      pendingHealthBlockRef.current = null;
      idRef.current = saved.nextEntryId;
      seedRef.current = saved.seedCode;
      // Only mark persisted if this boot is from a shared deep link.
      seedSavedRef.current = Boolean(seedCode);
      openingWorldRef.current = saved.openingWorld
        ? { ...saved.openingWorld }
        : saved.history[0]?.role === "assistant"
          ? { ...saved.history[0] }
          : null;
      const last = historyRef.current[historyRef.current.length - 1];
      let restoredEntries = saved.entries;
      if (last?.role === "user" && !saved.ended) {
        while (
          restoredEntries.length > 0 &&
          restoredEntries[restoredEntries.length - 1].type === "engine"
        ) {
          restoredEntries = restoredEntries.slice(0, -1);
        }
      }
      setEntries(restoredEntries);
      entriesRef.current = restoredEntries;
      setEnded(saved.ended);
      endedRef.current = saved.ended;
      setSoftEnded(Boolean(saved.softEnded));
      softEndedRef.current = Boolean(saved.softEnded);
      setEndLabel(saved.endLabel);
      endLabelRef.current = saved.endLabel;
      setWorldReady(saved.worldReady);
      worldReadyRef.current = saved.worldReady;
      setSceneReady(true);
      sceneReadyRef.current = true;
      setBooted(true);
      if (
        !saved.worldReady &&
        historyRef.current.length === 1 &&
        historyRef.current[0]?.role === "assistant" &&
        !historyRef.current.some((t) => t.role === "user")
      ) {
        const scene = parseScene(historyRef.current[0].content).scene;
        startHydration(runIdRef.current, 0, scene.length);
      }
      if (last?.role === "user" && !saved.ended) {
        await streamTurn();
      } else {
        focusInput();
      }
      return;
    }

    if (saved && seedCode && saved.seedCode !== seedCode) {
      clearSession();
    }

    await beginFreshWorld();
  }, [seedCode, focusInput, streamTurn, beginFreshWorld, fetchEngineVersion, startHydration]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void boot();
  }, [boot]);

  useEffect(() => {
    preloadTypingSound();
    return () => stopTypingSound();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const value = input.trim().slice(0, MAX_INPUT);
      if (!value || !booted) return;

      if (isDevCommand(value)) {
        setInput("");
        runDevCommand(value);
        return;
      }

      if (busy || ended || !sceneReady) return;
      saveCheckpoint();
      setInput("");
      if (softEnded) {
        setSoftEnded(false);
        softEndedRef.current = false;
      }
      addEntry("player", value);
      historyRef.current.push({ role: "user", content: value });
      persistSession();

      if (!worldReadyRef.current) {
        if (
          !hydrationPromiseRef.current &&
          historyRef.current[0]?.role === "assistant"
        ) {
          const scene = parseScene(historyRef.current[0].content).scene;
          startHydration(runIdRef.current, 0, scene.length);
        }
        setBusy(true);
        setWorldHydrating(true);
        await waitForWorldReady();
        setBusy(false);
        setWorldHydrating(false);
        if (!worldReadyRef.current) {
          addEntry(
            "error",
            "WORLD STILL LOADING. Wait a moment and try again."
          );
          focusInput();
          return;
        }
      }

      await streamTurn();
    },
    [
      input,
      busy,
      ended,
      booted,
      sceneReady,
      softEnded,
      addEntry,
      streamTurn,
      saveCheckpoint,
      persistSession,
      runDevCommand,
      waitForWorldReady,
      startHydration,
      focusInput,
    ]
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

    if (seedRef.current && seedSavedRef.current) {
      announce(seedRef.current);
      return;
    }

    setSharing(true);
    try {
      const res = await fetch("/api/seed/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw: first.content,
          code: seedRef.current ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) {
        addEntry("error", data.error || "COULD NOT SAVE WORLD.");
      } else {
        seedRef.current = data.code;
        seedSavedRef.current = true;
        announce(data.code);
        persistSession();
      }
    } catch (err) {
      addEntry("error", `COULD NOT SAVE WORLD. ${String(err)}`);
    } finally {
      setSharing(false);
    }
  }, [busy, sharing, worldReady, addEntry, persistSession]);

  const newWorld = useCallback(() => {
    if (seedCode) {
      clearSession();
      window.location.assign("/");
      return;
    }
    resetForNewWorld();
    void beginFreshWorld();
  }, [seedCode, resetForNewWorld, beginFreshWorld]);

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
    syncTimingsRef.current = [];
    checkpointsRef.current = [];
    pendingHealthBlockRef.current = null;
    setEntries([]);
    setInput("");
    setEnded(false);
    setSoftEnded(false);
    setEndLabel(null);
    endedRef.current = false;
    softEndedRef.current = false;
    endLabelRef.current = null;
    setWorldReady(false);
    setBooted(true);
    historyRef.current.push({ ...opening });
    const scene = parseScene(opening.content).scene;
    void revealText(scene).then(() => {
      setSceneReady(true);
      sceneReadyRef.current = true;
      setWorldReady(true);
      worldReadyRef.current = true;
      focusInput();
      persistSession();
    });
  }, [busy, newWorld, revealText, focusInput, persistSession]);

  const rewind = useCallback(() => {
    if (busy) return;
    const cp = checkpointsRef.current.pop();
    if (!cp) return;
    historyRef.current = cp.history.map((t) => ({ ...t }));
    pendingHealthBlockRef.current = null;
    setEntries(cp.entries.map((e) => ({ ...e })));
    idRef.current = cp.entries.reduce((m, e) => Math.max(m, e.id), 0);
    setEnded(false);
    setSoftEnded(false);
    setEndLabel(null);
    endedRef.current = false;
    softEndedRef.current = false;
    endLabelRef.current = null;
    setInput("");
    focusInput();
    persistSession();
  }, [busy, focusInput, persistSession]);

  const remaining = MAX_INPUT - input.length;
  const showCursor = busy || !booted;
  const sendLocked = busy || !booted;
  const canRewind = checkpointsRef.current.length > 0;
  const placeholderText = !booted
    ? "loading the world... you can start typing"
    : busy
    ? worldSyncing
      ? "syncing world state... almost ready"
      : worldHydrating
      ? "world catching up... almost ready"
      : "type your next move... it sends when the world settles"
    : worldHydrating
    ? "world catching up... your move waits until ready"
    : softEnded
    ? "the world continues — what do you do?"
    : "what do you do?";

  return (
    <div
      className="crt"
      onClick={() => {
        // Don't steal focus after a text selection — focusing the input
        // clears the highlight immediately.
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        inputRef.current?.focus();
      }}
    >
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
              <button className="restart" onClick={newWorld}>
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
            {sendLocked && (
              <span className="send-lock">
                {worldSyncing ? "syncing" : worldHydrating ? "hydrating" : "loading"}
              </span>
            )}
            {!sendLocked && worldHydrating && (
              <span className="send-lock" aria-label="hydrating">
                hydrating
              </span>
            )}
            {!sendLocked && lastSyncWaitSec && (
              <span className="send-lock sync-done" aria-label="sync duration">
                {lastSyncWaitSec}
              </span>
            )}
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
            {!ended && softEnded && endLabel && (
              <span className="end-label">{endLabel}</span>
            )}
            {!ended && softEnded && (
              <button
                className="restart"
                onClick={() => {
                  setSoftEnded(false);
                  softEndedRef.current = false;
                  setEndLabel(null);
                  endLabelRef.current = null;
                  persistSession();
                  focusInput();
                }}
                disabled={busy}
                style={{ marginLeft: 12 }}
              >
                continue
              </button>
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
            <a className="restart" href="/patch-notes" style={{ marginLeft: 12 }}>
              patch notes
            </a>
            <button
              className="restart"
              onClick={(e) => {
                e.stopPropagation();
                setDebugTick((n) => n + 1);
                setDebugOpen(true);
              }}
              style={{ marginLeft: 12 }}
              type="button"
            >
              debug
            </button>
            {!ended && (
              <button
                className="restart"
                onClick={newWorld}
                style={{ marginLeft: 12 }}
              >
                new world
              </button>
            )}
          </span>
        </div>
      </div>

      <DebugPanel
        key={debugTick}
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        history={historyRef.current.map((t) => ({ ...t }))}
        meta={{
          seedCode: seedRef.current,
          dialCode: seedRef.current
            ? parseSeedCode(seedRef.current)?.dial_code ?? null
            : null,
          instanceId: seedRef.current
            ? parseSeedCode(seedRef.current)?.instance_id || null
            : null,
          turnCount: historyRef.current.filter((t) => t.role === "user").length,
          assistantTurns: historyRef.current.filter(
            (t) => t.role === "assistant"
          ).length,
          ended,
          softEnded,
          endLabel,
          worldReady,
          sceneReady,
          worldHydrating,
          syncTimings: syncTimingsRef.current,
        }}
      />
    </div>
  );
}
