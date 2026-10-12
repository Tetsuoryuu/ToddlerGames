export interface SpeakOptions {
  voiceName?: string;
  style?: string;
  pitch?: number;
  rate?: number;
}

/**
 * Expressive Character & Narrator Voice Output.
 * Uses Gemini 3.8 Flash TTS (`gemini-3.8-flash-lite-tts` / `gemini-3.8-flash-tts`) via `/api/tts`,
 * which returns native `audio/wav` with a RIFF header, and falls back to browser `speechSynthesis`
 * when offline or when no API key is configured.
 *
 * Guarantees strict single-voice playback:
 * - Monotonically increasing `speakToken` cancels any in-flight `/api/tts` fetch if a newer
 *   `speak()` or `stop()` occurs while awaiting network audio, preventing overlapping voices.
 * - `speak()` resolves to `true` if the line finished speaking naturally, or `false` if it was
 *   interrupted/preempted by a newer event so callers never run stale follow-up prompts.
 */
export class SpeechOutputEngine {
  private currentAudio: HTMLAudioElement | null = null;
  private useGeminiTts = true;
  private audioCache = new Map<string, Promise<string | null>>();
  private speakToken = 0;
  private activeResolve: ((completed: boolean) => void) | null = null;
  private onSpeakStartCallback: (() => void) | null = null;

  public setUseGeminiTts(enabled: boolean): void {
    this.useGeminiTts = enabled;
  }

  public setOnSpeakStart(cb: () => void): void {
    this.onSpeakStartCallback = cb;
  }

  public isSpeaking(): boolean {
    if (this.currentAudio && !this.currentAudio.paused) {
      return true;
    }
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
      return true;
    }
    return false;
  }

  public stop(): void {
    // Invalidate any in-flight prefetch awaiting inside speak()
    this.speakToken++;

    if (this.currentAudio) {
      try {
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.pause();
        this.currentAudio.src = '';
      } catch {
        // Ignore audio cleanup errors
      }
      this.currentAudio = null;
    }

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speechSynthesis cleanup errors
      }
    }

    if (this.activeResolve) {
      const resolve = this.activeResolve;
      this.activeResolve = null;
      resolve(false);
    }
  }

  /**
   * Pre-fetches Gemini 3.8 TTS WAV audio in the background (e.g. while an ingredient floats
   * or while the child stirs the pot) so playback is 0ms instant when triggered!
   */
  public prefetch(
    text: string,
    options: SpeakOptions = {}
  ): Promise<string | null> {
    const clean = text.trim();
    if (!clean || !this.useGeminiTts) return Promise.resolve(null);

    const voiceName = options.voiceName || 'Puck';
    const style =
      options.style ||
      'cheerful, warm, animated cartoon voice speaking to a 4-year-old child';
    const key = `${voiceName}|${style}|${clean}`;

    const existing = this.audioCache.get(key);
    if (existing) return existing;

    const req = fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, voiceName, style }),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { audioBase64?: string | null };
        return data.audioBase64 || null;
      })
      .catch(() => null);

    // Keep cache bounded
    if (this.audioCache.size > 40) {
      const firstKey = this.audioCache.keys().next().value;
      if (firstKey) this.audioCache.delete(firstKey);
    }
    this.audioCache.set(key, req);
    return req;
  }

  /**
   * Speaks the given line and resolves to `true` if it finished naturally,
   * or `false` if interrupted by `stop()` or a newer `speak()` call.
   */
  public async speak(
    text: string,
    options: SpeakOptions = {}
  ): Promise<boolean> {
    this.stop();
    if (!text.trim()) return false;

    const myToken = ++this.speakToken;
    this.onSpeakStartCallback?.();

    const voiceName = options.voiceName || 'Puck';
    const style =
      options.style ||
      'cheerful, warm, animated cartoon voice speaking to a 4-year-old child';

    if (this.useGeminiTts) {
      try {
        const audioBase64 = await this.prefetch(text, { voiceName, style });
        // If another speak() or stop() happened while we were awaiting network TTS, abort immediately!
        if (myToken !== this.speakToken) {
          return false;
        }
        if (audioBase64) {
          return await this.playBase64Wav(audioBase64, myToken);
        }
      } catch (err) {
        if (myToken !== this.speakToken) return false;
        console.warn('Gemini 3.8 TTS fallback to browser speechSynthesis:', err);
      }
    }

    if (myToken !== this.speakToken) {
      return false;
    }

    // Browser Web Speech API fallback (strip Gemini 3.8 inline vocal tags like <laugh>)
    const cleanForBrowser = text
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return await this.speakWithBrowser(
      cleanForBrowser,
      options.pitch ?? 1.1,
      options.rate ?? 1.0,
      myToken
    );
  }

  private playBase64Wav(base64Data: string, myToken: number): Promise<boolean> {
    if (myToken !== this.speakToken) {
      return Promise.resolve(false);
    }

    // Ensure no previous audio element can possibly remain playing
    if (this.currentAudio) {
      try {
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.pause();
        this.currentAudio.src = '';
      } catch {
        // Ignore
      }
      this.currentAudio = null;
    }

    return new Promise((resolve) => {
      const audio = new Audio(`data:audio/wav;base64,${base64Data}`);
      this.currentAudio = audio;
      this.activeResolve = resolve;

      const finish = (completed: boolean) => {
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        if (this.activeResolve === resolve) {
          this.activeResolve = null;
          resolve(completed);
        }
      };

      audio.onended = () => finish(myToken === this.speakToken);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
    });
  }

  private speakWithBrowser(
    text: string,
    pitch: number,
    rate: number,
    myToken: number
  ): Promise<boolean> {
    if (myToken !== this.speakToken) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve(false);
        return;
      }

      this.activeResolve = resolve;
      const finish = (completed: boolean) => {
        if (this.activeResolve === resolve) {
          this.activeResolve = null;
          resolve(completed);
        }
      };

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = pitch;
      utterance.rate = rate;

      const voices = window.speechSynthesis.getVoices();
      const friendlyVoice =
        voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('Natural') ||
              v.name.includes('Google') ||
              v.name.includes('Zira') ||
              v.name.includes('Aria'))
        ) || voices.find((v) => v.lang.startsWith('en'));

      if (friendlyVoice) {
        utterance.voice = friendlyVoice;
      }

      const safetyTimer = window.setTimeout(
        () => finish(myToken === this.speakToken),
        7500
      );
      utterance.onend = () => {
        window.clearTimeout(safetyTimer);
        finish(myToken === this.speakToken);
      };
      utterance.onerror = () => {
        window.clearTimeout(safetyTimer);
        finish(false);
      };

      window.speechSynthesis.speak(utterance);
    });
  }
}

export const speechOut = new SpeechOutputEngine();
