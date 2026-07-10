export function extractWorldBlock(content: string): string | null {
  const m = content.match(/\[\s*WORLD\s*\]/i);
  if (!m || m.index === undefined) return null;
  return content.slice(m.index + m[0].length).trim();
}

export function extractSceneBlock(content: string): string | null {
  const sceneM = content.match(/\[\s*SCENE\s*\]/i);
  const worldM = content.match(/\[\s*WORLD\s*\]/i);
  if (!sceneM || sceneM.index === undefined) {
    if (worldM && worldM.index !== undefined) {
      return content.slice(0, worldM.index).trim() || null;
    }
    return null;
  }
  const start = sceneM.index + sceneM[0].length;
  const end =
    worldM && worldM.index !== undefined && worldM.index > sceneM.index
      ? worldM.index
      : content.length;
  return content.slice(start, end).trim() || null;
}

function tryParseJsonObject(src: string): unknown | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = src.slice(0, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  try {
    return JSON.parse(src);
  } catch {
    return null;
  }
}

/** Pull the JSON object after a bare `STATE` line inside [WORLD]. */
export function extractStateJson(worldOrRaw: string): unknown | null {
  const world = extractWorldBlock(worldOrRaw) ?? worldOrRaw;
  const stateLine = world.match(/(?:^|\n)\s*STATE\s*\n/i);
  if (!stateLine || stateLine.index === undefined) {
    const brace = world.indexOf("{");
    if (brace === -1) return null;
    return tryParseJsonObject(world.slice(brace));
  }
  const after = world.slice(stateLine.index + stateLine[0].length);
  const brace = after.indexOf("{");
  if (brace === -1) return null;
  return tryParseJsonObject(after.slice(brace));
}
