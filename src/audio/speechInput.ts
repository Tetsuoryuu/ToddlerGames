type TranscriptCallback = (transcript: string) => void;
type StatusCallback = (isListening: boolean, interimText: string) => void;

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

const CLIENT_PURE_FILLER_REGEX =
  /^(um+|uh+|er+|erm+|hm+|ah+|oh+|ooh+|huh|well|like|so|wait|hold on|hang on|one second|a second|let me think|let me see|i'?m thinking|i don'?t know|dunno|not sure|you say it|you pick|you choose|you do it|you tell me|what should i say|what do i say|tell me|help me|yes|yeah|yep|no|nope|not yet|okay|ok|great|good|cool|awesome|nice|yay|wow|sure|alright|fine|thank you|thanks|please|hi|hello|hey|what|who|why|where|how|mama|mommy|mom|dada|daddy|dad|papa|maybe|nothing|anything|something|the|a|an|and|\s)+$/i;

export function isPureFillerOrHesitation(rawText: string): boolean {
  const cleaned = rawText
    .replace(/[.!?,"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 2) return true;
  return CLIENT_PURE_FILLER_REGEX.test(cleaned);
}

/**
 * Toddler-friendly Voice Input Engine:
 * - Patiently listens continuously (up to 30s per window, auto-extending on hesitation)
 *   because a 4-year-old takes time to decide and often says "umm", "wait", "great",
 *   "you say it", or "I don't know" before naming an actual ingredient, guest, or name.
 * - Filters out pure filler/interjections immediately in 0ms without stopping the mic.
 * - Uses browser SpeechRecognition for live interim words AND records audio in parallel
 *   so if browser SpeechRecognition misses a 4-year-old's voice, it can fall back to
 *   `gemini-3.5-transcribe` on the backend!
 */
export class SpeechInputEngine {
  private recognition: SpeechRecognitionInstance | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isListening = false;
  private latestInterim = '';
  private processedResultIndex = 0;
  private lastEvaluatedPhrase = '';
  private silenceSettleTimerId: number | null = null;
  private timeoutId: number | null = null;
  private currentMaxDurationMs = 25000;

  private onTranscript: TranscriptCallback;
  private onStatus: StatusCallback;

  constructor(onTranscript: TranscriptCallback, onStatus: StatusCallback) {
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.initBrowserSpeech();
  }

  private initBrowserSpeech(): void {
    const Win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = Win.SpeechRecognition || Win.webkitSpeechRecognition;
    if (!SpeechRec) return;

    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      if (!this.isListening) return;

      let activeSegmentText = '';
      let finalizedPhrase = '';

      for (let i = this.processedResultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const chunk = (res[0]?.transcript || '').trim();
        if (res.isFinal) {
          this.processedResultIndex = i + 1;
          if (chunk) {
            finalizedPhrase += (finalizedPhrase ? ' ' : '') + chunk;
          }
        } else {
          activeSegmentText += (activeSegmentText ? ' ' : '') + chunk;
        }
      }

      const displayInterim = (finalizedPhrase || activeSegmentText).trim();
      if (displayInterim) {
        this.latestInterim = displayInterim;
        this.onStatus(true, displayInterim);
        this.resetInactivityTimeout(this.currentMaxDurationMs);
      }

      if (this.silenceSettleTimerId) {
        window.clearTimeout(this.silenceSettleTimerId);
        this.silenceSettleTimerId = null;
      }

      if (finalizedPhrase) {
        this.evaluateCandidatePhrase(finalizedPhrase);
      } else if (activeSegmentText) {
        // If the browser holds a phrase in interim state while the child pauses for ~1.15s, evaluate it
        this.silenceSettleTimerId = window.setTimeout(() => {
          if (this.isListening && activeSegmentText) {
            this.evaluateCandidatePhrase(activeSegmentText);
          }
        }, 1150);
      }
    };

    rec.onerror = () => {
      // Let MediaRecorder / Gemini 3.5 Transcribe or auto-restart handle fallback
    };

    rec.onend = () => {
      if (!this.isListening) return;
      // Keep SpeechRecognition alive while we are still patiently waiting for a real answer
      try {
        this.processedResultIndex = 0;
        rec.start();
      } catch {
        // If browser refuses immediate restart, let MediaRecorder fallback handle it when timer expires
      }
    };

    this.recognition = rec;
  }

  private evaluateCandidatePhrase(rawPhrase: string): void {
    const candidate = rawPhrase.trim();
    if (!candidate || candidate === this.lastEvaluatedPhrase) return;
    this.lastEvaluatedPhrase = candidate;

    // Fast 0ms client-side rejection of pure toddler hesitations/interjections ("umm", "wait", "great", "you say it", etc.)
    if (isPureFillerOrHesitation(candidate)) {
      this.latestInterim = '';
      this.onStatus(
        true,
        `💭 Heard "${candidate}" — take your time, I'm still listening!`
      );
      this.resetInactivityTimeout(this.currentMaxDurationMs);
      return;
    }

    // Pass candidate to main controller for semantic validation (`validateAndExtractToddlerSpeech`).
    // Notice we do NOT stop listening here yet — main.ts calls `stopListening()` once the candidate is validated!
    this.latestInterim = '';
    this.onTranscript(candidate);
  }

  private resetInactivityTimeout(durationMs: number): void {
    if (this.timeoutId) window.clearTimeout(this.timeoutId);
    this.timeoutId = window.setTimeout(() => {
      if (!this.isListening) return;
      if (
        this.latestInterim &&
        !isPureFillerOrHesitation(this.latestInterim) &&
        this.latestInterim !== this.lastEvaluatedPhrase
      ) {
        this.evaluateCandidatePhrase(this.latestInterim);
      } else {
        this.finishWithTranscribeFallback();
      }
    }, durationMs);
  }

  public async startListening(maxDurationMs = 25000): Promise<void> {
    this.currentMaxDurationMs = Math.max(maxDurationMs, 22000);
    if (this.isListening) {
      this.resetInactivityTimeout(this.currentMaxDurationMs);
      return;
    }

    this.isListening = true;
    this.latestInterim = '';
    this.processedResultIndex = 0;
    this.lastEvaluatedPhrase = '';
    this.audioChunks = [];
    this.onStatus(true, 'Listening... Take your time!');

    // Start browser SpeechRecognition if available
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch {
        // Already started
      }
    }

    // Also start MediaRecorder for gemini-3.5-transcribe fallback
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!this.isListening) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const recorder = new MediaRecorder(stream);
      this.mediaRecorder = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };
      recorder.start();
    } catch {
      // Mic permission not granted or unavailable
    }

    this.resetInactivityTimeout(this.currentMaxDurationMs);
  }

  public notifyHesitationIgnored(heardText: string, promptHint: string): void {
    this.latestInterim = '';
    this.lastEvaluatedPhrase = '';
    if (!this.isListening) {
      void this.startListening(this.currentMaxDurationMs);
    } else {
      this.resetInactivityTimeout(this.currentMaxDurationMs);
    }
    this.onStatus(true, `💭 Heard "${heardText}" — ${promptHint}`);
  }

  public stopListening(): void {
    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.silenceSettleTimerId) {
      window.clearTimeout(this.silenceSettleTimerId);
      this.silenceSettleTimerId = null;
    }
    this.isListening = false;
    this.latestInterim = '';
    this.onStatus(false, '');

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
        this.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Ignore
      }
    }
    this.mediaRecorder = null;
  }

  public toggleListening(): void {
    if (this.isListening) {
      if (this.latestInterim && !isPureFillerOrHesitation(this.latestInterim)) {
        const words = this.latestInterim;
        this.stopListening();
        this.onTranscript(words);
      } else {
        this.finishWithTranscribeFallback();
      }
    } else {
      void this.startListening(25000);
    }
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  private finishWithTranscribeFallback(): void {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') {
      this.stopListening();
      return;
    }

    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.silenceSettleTimerId) {
      window.clearTimeout(this.silenceSettleTimerId);
      this.silenceSettleTimerId = null;
    }
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
    }
    this.onStatus(true, 'Listening closely to what you said...');

    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(this.audioChunks, {
        type: recorder.mimeType || 'audio/webm',
      });
      this.audioChunks = [];

      if (blob.size < 1000) {
        this.onStatus(false, '');
        return;
      }

      try {
        const audioBase64 = await this.blobToBase64(blob);
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType: blob.type || 'audio/webm',
          }),
        });
        this.onStatus(false, '');
        if (res.ok) {
          const data = (await res.json()) as { transcript?: string };
          const text = (data.transcript || '').trim();
          if (text && !isPureFillerOrHesitation(text)) {
            this.onTranscript(text);
          } else {
            // Only silence/filler heard in audio window — resume patient listening!
            void this.startListening(this.currentMaxDurationMs);
          }
        }
      } catch {
        this.onStatus(false, '');
      }
    };

    try {
      recorder.stop();
    } catch {
      this.onStatus(false, '');
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = String(reader.result || '');
        const base64 = res.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
