// Parse raw engine output into the visible scene and control tokens.

export const END_TOKEN = "<END>";
export const SOFT_END_TOKEN = "<SOFT_END>";
export const DIVERGE_TOKEN = "<DIVERGE>";
const ENDLABEL_RE = /<ENDLABEL>([\s\S]*?)<\/ENDLABEL>/i;

export type ParsedScene = {
  scene: string;
  ended: boolean;
  softEnded: boolean;
  diverged: boolean;
  endLabel: string | null;
};

/** True once the stream has entered the hidden [WORLD] block. */
export function hasWorldMarker(raw: string): boolean {
  return /\[\s*WORLD\s*\]/i.test(raw);
}

export function parseScene(raw: string): ParsedScene {
  const sceneM = raw.match(/\[\s*SCENE\s*\]/i);
  const worldM = raw.match(/\[\s*WORLD\s*\]/i);
  const sceneIdx = sceneM ? (sceneM.index ?? -1) : -1;
  const worldIdx = worldM ? (worldM.index ?? -1) : -1;

  let text: string;
  if (sceneIdx !== -1) {
    const start = sceneIdx + sceneM![0].length;
    let end = worldIdx > sceneIdx ? worldIdx : raw.length;
    // Model sometimes skips [WORLD] and jumps straight to STATE JSON.
    if (worldIdx <= sceneIdx) {
      const tail = raw.slice(start);
      const stateM = tail.match(/\n\s*STATE\s*\n/i);
      if (stateM && stateM.index !== undefined) {
        end = start + stateM.index;
      }
    }
    text = raw.slice(start, end);
  } else {
    // Never surface the raw stream buffer — wait for [SCENE] or show nothing.
    text = "";
  }

  let diverged = false;
  if (text.includes(DIVERGE_TOKEN)) {
    diverged = true;
    text = text.split(DIVERGE_TOKEN).join("");
  }

  let endLabel: string | null = null;
  const labelM = text.match(ENDLABEL_RE);
  if (labelM) {
    endLabel = labelM[1].trim().slice(0, 80) || null;
    text = text.replace(ENDLABEL_RE, "");
  }

  let softEnded = false;
  const softIdx = text.indexOf(SOFT_END_TOKEN);
  if (softIdx !== -1) {
    softEnded = true;
    text = text.slice(0, softIdx) + text.slice(softIdx + SOFT_END_TOKEN.length);
  }

  let ended = false;
  const endIdx = text.indexOf(END_TOKEN);
  if (endIdx !== -1) {
    ended = true;
    text = text.slice(0, endIdx);
  }

  // Hard end wins if both somehow appear.
  if (ended) softEnded = false;

  return { scene: text.trim(), ended, softEnded, diverged, endLabel };
}

// Strip control tokens before storing assistant turns in history.
export function stripControlTokens(raw: string): string {
  return raw
    .replace(END_TOKEN, "")
    .replace(SOFT_END_TOKEN, "")
    .split(DIVERGE_TOKEN)
    .join("")
    .replace(ENDLABEL_RE, "")
    .trim();
}
