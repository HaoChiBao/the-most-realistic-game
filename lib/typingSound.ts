/** Looping typewriter SFX while engine text is revealed character-by-character. */

const SOUND_URL = "/sounds/response_typing_sound.wav";
const VOLUME = 0.35;

let audio: HTMLAudioElement | null = null;
let playing = false;

function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio(SOUND_URL);
    audio.loop = true;
    audio.volume = VOLUME;
    audio.preload = "auto";
  }
  return audio;
}

/** Preload so the first reveal does not hitch on decode. */
export function preloadTypingSound(): void {
  getAudio();
}

/** Idempotent — safe to call every animation frame. */
export function syncTypingSound(active: boolean): void {
  if (active === playing) return;
  playing = active;
  const el = getAudio();
  if (!el) return;
  if (active) {
    void el.play().catch(() => {
      // Autoplay policy may block until user gesture; ignore.
    });
  } else {
    el.pause();
    el.currentTime = 0;
  }
}

export function startTypingSound(): void {
  syncTypingSound(true);
}

export function stopTypingSound(): void {
  syncTypingSound(false);
}
