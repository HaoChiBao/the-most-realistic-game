/** Looping typewriter SFX while engine text is revealed character-by-character. */

const SOUND_URL = "/sounds/response_typing_sound.wav";
const VOLUME = 0.35;

let audio: HTMLAudioElement | null = null;
let activeSessions = 0;

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

export function startTypingSound(): void {
  const el = getAudio();
  if (!el) return;
  activeSessions += 1;
  if (activeSessions === 1) {
    void el.play().catch(() => {
      // Autoplay policy may block until user gesture; ignore.
    });
  }
}

export function stopTypingSound(): void {
  if (activeSessions === 0) return;
  activeSessions = Math.max(0, activeSessions - 1);
  if (activeSessions === 0 && audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}
