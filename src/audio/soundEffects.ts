import type { ReactionType } from '../types.ts';

/**
 * Procedural Web Audio API Cartoon Sound Synthesizer.
 * Generates zero-latency, cheerful sound effects for a 4-year-old without needing external MP3 files.
 */
class SoundEffectsEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private lastChimeTime = 0;
  private lastStirTime = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  /**
   * Sparkly magic wand chime when waving hands over the Magic Cloud
   */
  public playMagicChime(progress = 0.5): void {
    const now = performance.now();
    if (now - this.lastChimeTime < 95) return;
    this.lastChimeTime = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    // Pentatonic scale notes that rise with progress
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
    const idx = Math.min(
      scale.length - 1,
      Math.floor(progress * (scale.length - 2)) + Math.floor(Math.random() * 3)
    );
    const freq = scale[idx];

    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, t + 0.18);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.23);
  }

  /**
   * Big celebratory POP + fanfare when a summoned character jumps out of the Magic Cloud!
   */
  public playCharacterAppear(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  /**
   * Bouncy cartoon boing when swatting a floating ingredient with a hand
   */
  public playBoing(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240 + Math.random() * 80, t);
    osc.frequency.exponentialRampToValueAtTime(580 + Math.random() * 120, t + 0.16);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.19);
  }

  /**
   * Juicy cartoon SPLASH + bloop when an ingredient drops into the cauldron
   */
  public playCauldronSplash(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;

    // 1. Water bloop arpeggio
    const bloops = [320, 480, 690, 520];
    bloops.forEach((freq, idx) => {
      const bt = t + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 0.7, bt);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.4, bt + 0.09);
      gain.gain.setValueAtTime(0.25, bt);
      gain.gain.exponentialRampToValueAtTime(0.001, bt + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(bt);
      osc.stop(bt + 0.12);
    });
  }

  /**
   * Swirling bubble sound while stirring the pot with hands
   */
  public playStirSwirl(progress: number): void {
    const now = performance.now();
    if (now - this.lastStirTime < 120) return;
    this.lastStirTime = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    const baseFreq = 260 + progress * 440;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, t + 0.11);

    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  /**
   * Gulp sound when the character eats the magic spoonful
   */
  public playGulp(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    [0, 0.18, 0.36].forEach((offset) => {
      const t = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(160, t + 0.12);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  /**
   * Plays a custom sound effect matching the 6 slapstick soup reactions
   */
  public playReactionSound(reaction: ReactionType): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    if (reaction === 'delicious') {
      // Disco party chord
      [523.25, 659.25, 783.99, 987.77, 1046.5].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t + i * 0.08);
        gain.gain.setValueAtTime(0.2, t + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.08);
        osc.stop(t + i * 0.08 + 0.46);
      });
    } else if (reaction === 'spicy') {
      // Rising steam whistle!
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, t);
      osc.frequency.exponentialRampToValueAtTime(1500, t + 0.7);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.76);
    } else if (reaction === 'freezing') {
      // Shivering icy crystal chimes
      [1200, 1450, 1100, 1600, 1350].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t + i * 0.07);
        gain.gain.setValueAtTime(0.16, t + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.07);
        osc.stop(t + i * 0.07 + 0.26);
      });
    } else if (reaction === 'yucky') {
      // Goofy Descending Wah-Wah trombone
      [392, 369.99, 349.23, 329.63].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, t + i * 0.16);
        osc.frequency.linearRampToValueAtTime(f * 0.92, t + i * 0.16 + 0.14);
        gain.gain.setValueAtTime(0.15, t + i * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.16 + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.16);
        osc.stop(t + i * 0.16 + 0.16);
      });
    } else if (reaction === 'balloon') {
      // Inflating balloon stretch sound
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(720, t + 0.65);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.72);
    } else if (reaction === 'giant') {
      // Giant bass stomp!
      [0, 0.28, 0.56].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, t + offset);
        osc.frequency.exponentialRampToValueAtTime(48, t + offset + 0.22);
        gain.gain.setValueAtTime(0.32, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.25);
      });
    }
  }

  /**
   * Hilarious cartoon BUUURP sound before the Bubble Finale!
   */
  public playCartoonBurp(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.linearRampToValueAtTime(135, t + 0.25);
    osc.frequency.linearRampToValueAtTime(78, t + 0.55);

    gain.gain.setValueAtTime(0.24, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.62);
  }

  /**
   * Crisp bubble pop sound when the toddler pops a burp bubble!
   */
  public playBubblePop(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const startFreq = 450 + Math.random() * 250;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 2.1, t + 0.065);

    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.075);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /**
   * Classic joyful two-tone steam train whistle ("CHOO-CHOO / WOO-WOO!")
   */
  public playTrainWhistle(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const chord = [349.23, 440.0, 523.25]; // Warm F major train whistle chord (F4, A4, C5)
    [
      { start: 0, dur: 0.24 },
      { start: 0.3, dur: 0.42 },
    ].forEach(({ start, dur }) => {
      chord.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq * 0.97, t + start);
        osc.frequency.linearRampToValueAtTime(freq, t + start + 0.05);
        gain.gain.setValueAtTime(0.001, t + start);
        gain.gain.linearRampToValueAtTime(0.11, t + start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + start);
        osc.stop(t + start + dur + 0.02);
      });
    });
  }

  /**
   * Punchy, playful cartoon "THOOMP-POP!" when the Flying Train's Smokestack Cannon fires!
   */
  public playTrainCannonShot(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.09);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.16);

    gain.gain.setValueAtTime(0.24, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.17);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  /**
   * Sparkling ascending rainbow chime when a Grumpy Storm Cloud turns into a Happy Rainbow Cloud!
   */
  public playCloudTransform(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.055);
      gain.gain.setValueAtTime(0.15, t + idx * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.055 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + idx * 0.055);
      osc.stop(t + idx * 0.055 + 0.3);
    });
  }
}

export const sfx = new SoundEffectsEngine();
