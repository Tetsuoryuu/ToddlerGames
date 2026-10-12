import type {
  CharacterItem,
  GameMode,
  GamePhase,
  IngredientItem,
  PantryData,
  ReactionType,
  SkyTarget,
  SoupEvaluation,
} from './types.ts';
import { HandTracker } from './vision/handTracker.ts';
import { GamePhysics } from './game/physics.ts';
import { GameRenderer } from './game/renderer.ts';
import { PantryUI } from './game/pantryUI.ts';
import { sfx } from './audio/soundEffects.ts';
import { speechOut } from './audio/speechOutput.ts';
import {
  SpeechInputEngine,
  isPureFillerOrHesitation,
} from './audio/speechInput.ts';
import { loadStickerImage } from './game/stickerUtils.ts';

class SillyChefGame {
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;
  private handTracker: HandTracker;
  private physics: GamePhysics;
  private renderer: GameRenderer;
  private pantryUI: PantryUI;
  private speechIn: SpeechInputEngine;

  private gameMode: GameMode = 'CAULDRON';
  private phase: GamePhase = 'WELCOME';
  private playerName = '';
  private pantryData: PantryData = { characters: [], ingredients: [] };
  private currentCharacter: CharacterItem | null = null;
  private pendingCharacterPromise: Promise<CharacterItem> | null = null;
  private potIngredients: IngredientItem[] = [];
  private activeTrainAmmo: IngredientItem | null = null;
  private soupColor = '#8b5cf6';
  private magicCloudProgress = 0;
  private stirProgress = 0;
  private activeReaction: ReactionType | null = null;
  private reactionStartTime = 0;
  private resolvedEvaluation: SoupEvaluation | null = null;
  private pendingEvaluationPromise: Promise<SoupEvaluation> | null = null;
  private lastMixChantTime = 0;
  private lastTrainChantTime = 0;
  private speechValidationSeq = 0;
  private lastFrameTime = performance.now();

  // DOM Elements
  private brandIconEl: HTMLElement;
  private brandTitleEl: HTMLElement;
  private modeCauldronBtn: HTMLButtonElement;
  private modeTrainBtn: HTMLButtonElement;
  private leftShelfHeaderEl: HTMLElement;
  private rightShelfHeaderEl: HTMLElement;
  private newGuestBtn: HTMLButtonElement;
  private bannerEl: HTMLElement;
  private bannerTitleEl: HTMLElement;
  private bannerSubEl: HTMLElement;
  private micBtn: HTMLButtonElement;
  private micBtnLabel: HTMLElement;
  private apiBadgeEl: HTMLElement;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.video = document.getElementById('webcam-video') as HTMLVideoElement;
    this.brandIconEl = document.getElementById('brand-icon') as HTMLElement;
    this.brandTitleEl = document.getElementById('brand-title') as HTMLElement;
    this.modeCauldronBtn = document.getElementById(
      'mode-cauldron-btn'
    ) as HTMLButtonElement;
    this.modeTrainBtn = document.getElementById(
      'mode-train-btn'
    ) as HTMLButtonElement;
    this.leftShelfHeaderEl = document.getElementById(
      'left-shelf-header'
    ) as HTMLElement;
    this.rightShelfHeaderEl = document.getElementById(
      'right-shelf-header'
    ) as HTMLElement;
    this.newGuestBtn = document.getElementById(
      'new-guest-btn'
    ) as HTMLButtonElement;
    this.bannerEl = document.getElementById('prompt-banner') as HTMLElement;
    this.bannerTitleEl = document.getElementById('banner-title') as HTMLElement;
    this.bannerSubEl = document.getElementById('banner-subtitle') as HTMLElement;
    this.micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
    this.micBtnLabel = document.getElementById('mic-btn-label') as HTMLElement;
    this.apiBadgeEl = document.getElementById('api-status-badge') as HTMLElement;

    this.handTracker = new HandTracker(this.video);
    this.physics = new GamePhysics();
    this.renderer = new GameRenderer(this.canvas);

    this.pantryUI = new PantryUI(
      document.getElementById('character-shelf') as HTMLElement,
      document.getElementById('ingredient-shelf') as HTMLElement,
      (char) => this.selectCharacterFromShelf(char),
      (ing) => this.spawnIngredientFromShelf(ing)
    );

    this.speechIn = new SpeechInputEngine(
      (transcript) => void this.handleVoiceTranscript(transcript, false),
      (isListening, interim) => this.handleMicStatus(isListening, interim)
    );

    // Ensure microphone never records the narrator or guest's own voice while TTS is speaking
    speechOut.setOnSpeakStart(() => {
      if (this.speechIn.getIsListening()) {
        this.speechIn.stopListening();
      }
    });

    this.setupResize();
    this.setupControls();
    void this.loadInitialData();
  }

  private get chefTitle(): string {
    return this.playerName ? `Chef ${this.playerName}` : 'Little Chef';
  }

  private get captainTitle(): string {
    return this.playerName ? `Captain ${this.playerName}` : 'Little Captain';
  }

  private setupResize(): void {
    const resize = () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();
  }

  private setupControls(): void {
    // Welcome start buttons (Magic Soup OR Flying Train)
    const startBtn = document.getElementById('start-game-btn');
    const startTrainBtn = document.getElementById('start-train-btn');
    const welcomeModal = document.getElementById('welcome-modal');

    startBtn?.addEventListener('click', async () => {
      welcomeModal?.classList.add('hidden');
      sfx.unlock();
      await this.handTracker.init();
      await this.switchGameMode('CAULDRON');
    });

    startTrainBtn?.addEventListener('click', async () => {
      welcomeModal?.classList.add('hidden');
      sfx.unlock();
      await this.handTracker.init();
      await this.switchGameMode('FLYING_TRAIN');
    });

    // Top bar Game Mode Switcher buttons
    this.modeCauldronBtn?.addEventListener('click', () => {
      sfx.unlock();
      welcomeModal?.classList.add('hidden');
      void this.switchGameMode('CAULDRON');
    });
    this.modeTrainBtn?.addEventListener('click', () => {
      sfx.unlock();
      welcomeModal?.classList.add('hidden');
      void this.switchGameMode('FLYING_TRAIN');
    });

    // Mic button
    this.micBtn.addEventListener('click', () => {
      sfx.unlock();
      speechOut.stop();
      if (!this.playerName && this.phase !== 'ASK_PLAYER_NAME') {
        void this.startAskPlayerNamePrompt();
        return;
      }
      this.speechIn.toggleListening();
    });

    // Spacebar push-to-talk / toggle override
    window.addEventListener('keydown', (e) => {
      if (
        e.code === 'Space' &&
        document.activeElement?.tagName !== 'INPUT' &&
        this.phase !== 'WELCOME'
      ) {
        e.preventDefault();
        sfx.unlock();
        speechOut.stop();
        if (!this.playerName && this.phase !== 'ASK_PLAYER_NAME') {
          void this.startAskPlayerNamePrompt();
          return;
        }
        this.speechIn.toggleListening();
      }
    });

    // New Friend / New Clouds button
    this.newGuestBtn?.addEventListener('click', () => {
      sfx.unlock();
      if (this.gameMode === 'FLYING_TRAIN') {
        void this.startFlyingTrainRound(true);
      } else {
        void this.startSummonPrompt();
      }
    });

    // Surprise Ingredient / Surprise Ammo button
    document
      .getElementById('surprise-ingredient-btn')
      ?.addEventListener('click', () => {
        sfx.unlock();
        if (!this.currentCharacter && this.pantryData.characters.length > 0) {
          this.currentCharacter = this.pantryData.characters[0];
        }
        const list = this.pantryData.ingredients;
        if (list.length > 0) {
          const randomIng = list[Math.floor(Math.random() * list.length)];
          this.spawnIngredientFromShelf(randomIng);
        }
      });

    // Reset Round button
    document.getElementById('reset-pot-btn')?.addEventListener('click', () => {
      sfx.unlock();
      if (this.gameMode === 'FLYING_TRAIN') {
        void this.startFlyingTrainRound(false);
      } else {
        this.resetSoupWithCurrentGuest();
      }
    });

    // Collapsible Parent Co-Pilot text box
    const parentForm = document.getElementById('parent-form') as HTMLFormElement;
    const parentToggleBtn = document.getElementById('parent-toggle-btn');
    const parentInput = document.getElementById('parent-input') as HTMLInputElement;

    parentToggleBtn?.addEventListener('click', () => {
      parentForm?.classList.toggle('collapsed');
      if (!parentForm?.classList.contains('collapsed')) {
        parentInput?.focus();
      }
    });

    parentForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = parentInput.value.trim();
      if (!val) return;
      parentInput.value = '';
      parentForm.classList.add('collapsed');
      this.speechIn.stopListening();
      void this.handleVoiceTranscript(val, true);
    });
  }

  private updateBrandAndModeUI(): void {
    if (this.gameMode === 'FLYING_TRAIN') {
      this.modeTrainBtn?.classList.add('active');
      this.modeCauldronBtn?.classList.remove('active');
      if (this.brandIconEl) this.brandIconEl.textContent = '🚂🌈';
      if (this.brandTitleEl) {
        this.brandTitleEl.textContent = this.playerName
          ? `Captain ${this.playerName}`
          : 'Sky Choo-Choo';
      }
      if (this.leftShelfHeaderEl) {
        this.leftShelfHeaderEl.textContent = '👩‍✈️';
      }
      if (this.rightShelfHeaderEl) {
        this.rightShelfHeaderEl.textContent = '🚀';
      }
      if (this.newGuestBtn) {
        this.newGuestBtn.textContent = '🌈 Clouds';
      }
    } else {
      this.modeCauldronBtn?.classList.add('active');
      this.modeTrainBtn?.classList.remove('active');
      if (this.brandIconEl) this.brandIconEl.textContent = '🧙‍♂️🍲';
      if (this.brandTitleEl) {
        this.brandTitleEl.textContent = this.playerName
          ? `Chef ${this.playerName}`
          : 'Silly Chef';
      }
      if (this.leftShelfHeaderEl) {
        this.leftShelfHeaderEl.textContent = '👑';
      }
      if (this.rightShelfHeaderEl) {
        this.rightShelfHeaderEl.textContent = '🍓';
      }
      if (this.newGuestBtn) {
        this.newGuestBtn.textContent = '🦄 Friend';
      }
    }
  }

  private async switchGameMode(mode: GameMode): Promise<void> {
    this.speechIn.stopListening();
    speechOut.stop();
    this.gameMode = mode;
    this.updateBrandAndModeUI();

    if (!this.playerName) {
      await this.startAskPlayerNamePrompt();
      return;
    }

    if (mode === 'FLYING_TRAIN') {
      await this.startFlyingTrainRound(true);
    } else {
      if (this.currentCharacter) {
        this.resetSoupWithCurrentGuest();
      } else {
        await this.startSummonPrompt();
      }
    }
  }

  private async loadInitialData(): Promise<void> {
    try {
      const [statusRes, pantryRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/pantry'),
      ]);
      if (statusRes.ok) {
        const status = (await statusRes.json()) as { geminiConfigured: boolean };
        speechOut.setUseGeminiTts(status.geminiConfigured);
      }
      if (pantryRes.ok) {
        this.pantryData = (await pantryRes.json()) as PantryData;
        this.pantryUI.renderPantry(this.pantryData);
      }
    } catch (err) {
      console.warn('Could not reach backend initially:', err);
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private setBanner(title: string, _subtitle = ''): void {
    this.bannerTitleEl.textContent = title;
    this.bannerSubEl.textContent = '';
  }

  private handleMicStatus(isListening: boolean, interimText: string): void {
    if (isListening) {
      this.micBtn.classList.add('listening');
      this.bannerEl.classList.add('listening');
      this.micBtnLabel.textContent = 'Listening...';
      if (interimText) {
        this.bannerSubEl.textContent = `🗣️ "${interimText}"`;
      } else {
        this.bannerSubEl.textContent = '';
      }
    } else {
      this.micBtn.classList.remove('listening');
      this.bannerEl.classList.remove('listening');
      this.micBtnLabel.textContent = 'Speak!';
      this.bannerSubEl.textContent = '';
    }
  }

  /**
   * Phase 0: Ask the player's name via voice!
   */
  private async startAskPlayerNamePrompt(): Promise<void> {
    this.speechIn.stopListening();
    this.phase = 'ASK_PLAYER_NAME';

    const isTrain = this.gameMode === 'FLYING_TRAIN';
    this.setBanner(
      isTrain ? "🚂 What's your name?" : "👋 What's your name?"
    );

    const greetingPrompt = isTrain
      ? 'Choo-choo! Welcome aboard the Rainbow Sky Train! What is your name?'
      : 'Hi there, Little Chef! Welcome to the Magic Kitchen! What is your name?';

    const completed = await speechOut.speak(greetingPrompt, {
      voiceName: 'Kore',
      style: 'warm, friendly, excited storybook narrator speaking to a 4-year-old',
    });

    if (completed && this.phase === 'ASK_PLAYER_NAME') {
      void this.speechIn.startListening(25000);
    }
  }

  private extractPlayerName(rawTranscript: string): string {
    let cleaned = rawTranscript
      .replace(/[.!?,"']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    cleaned = cleaned.replace(
      /^(hi|hello|hey|umm+|uh+|wait|okay|ok)\s+/i,
      ''
    );
    cleaned = cleaned.replace(
      /^(my name is|i am|im|i'm|it is|its|it's|call me|chef|captain)\s+/i,
      ''
    );

    const words = cleaned.split(' ').filter(Boolean).slice(0, 2);
    if (words.length === 0) return 'Super Star';

    return words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private async handlePlayerNameCaptured(rawTranscript: string): Promise<void> {
    const name = this.extractPlayerName(rawTranscript);
    this.playerName = name;
    this.updateBrandAndModeUI();

    sfx.playCharacterAppear();
    this.physics.spawnSparkles(
      this.canvas.width * 0.5,
      this.canvas.height * 0.35,
      45,
      ['#facc15', '#f472b6', '#38bdf8', '#4ade80']
    );

    if (this.gameMode === 'FLYING_TRAIN') {
      sfx.playTrainWhistle();
      this.setBanner(`🌟 All Aboard, ${this.captainTitle}!`);

      const completed = await speechOut.speak(
        `Yay! All aboard the Rainbow Sky Train, ${this.captainTitle}!`,
        {
          voiceName: 'Kore',
          style: 'warm, joyful, and celebratory',
        }
      );
      if (!completed) return;

      await this.startFlyingTrainRound(true);
      return;
    }

    this.setBanner(`🌟 Hi ${this.chefTitle}!`);

    // Prefetch the summon prompt while greeting the player by name
    const summonLine = `Who is coming to eat ${this.chefTitle}'s magic soup today? Tell me who to summon!`;
    speechOut.prefetch(summonLine, {
      voiceName: 'Kore',
      style: 'warm, magical, excited storybook narrator speaking to a 4-year-old',
    });

    const completed = await speechOut.speak(
      `Yay! Nice to meet you, ${this.chefTitle}!`,
      {
        voiceName: 'Kore',
        style: 'warm, joyful, and celebratory',
      }
    );
    if (!completed) return;

    if (this.currentCharacter) {
      await this.promptForNextIngredient();
    } else {
      await this.startSummonPrompt();
    }
  }

  /**
   * Phase 1: Ask the 4-year-old who is coming to eat our magic soup today!
   */
  private async startSummonPrompt(): Promise<void> {
    this.speechIn.stopListening();
    this.phase = 'SUMMON_PROMPT';
    this.activeReaction = null;
    this.potIngredients = [];
    this.physics.floatingIngredients = [];
    this.physics.burpBubbles = [];
    this.physics.spoonPos.active = false;

    this.setBanner('🦄 Who is hungry today?');

    const promptText = this.playerName
      ? `Who is coming to eat ${this.chefTitle}'s magic soup today? Tell me who to summon!`
      : 'Welcome, Little Chef! Who is coming to eat our magic soup today? Tell me who to summon!';

    const completed = await speechOut.speak(promptText, {
      voiceName: 'Kore',
      style: 'warm, magical, excited storybook narrator speaking to a 4-year-old',
    });

    // Auto-listen right after asking the question!
    if (completed && this.phase === 'SUMMON_PROMPT') {
      void this.speechIn.startListening(25000);
    }
  }

  private getPatientListeningHint(): string {
    if (this.phase === 'ASK_PLAYER_NAME') {
      return "take your time! Tell me your name when you're ready!";
    }
    if (this.gameMode === 'FLYING_TRAIN') {
      return 'take your time! Shout any silly thing to shoot from the train cannon!';
    }
    if (this.phase === 'SUMMON_PROMPT' || !this.currentCharacter) {
      return 'take your time! Name any character or animal to summon!';
    }
    return 'take your time! Say any yummy food or silly thing for the soup!';
  }

  private async handleVoiceTranscript(
    transcript: string,
    skipValidation = false
  ): Promise<void> {
    const clean = transcript.trim();
    if (!clean) return;

    if (!skipValidation && isPureFillerOrHesitation(clean)) {
      this.speechIn.notifyHesitationIgnored(
        clean,
        this.getPatientListeningHint()
      );
      return;
    }

    const mode: 'player_name' | 'character' | 'ingredient' =
      this.phase === 'ASK_PLAYER_NAME'
        ? 'player_name'
        : this.gameMode === 'FLYING_TRAIN'
          ? 'ingredient'
          : this.phase === 'SUMMON_PROMPT' || !this.currentCharacter
            ? 'character'
            : 'ingredient';

    let finalValue = clean;

    if (!skipValidation) {
      const seq = ++this.speechValidationSeq;
      const phaseAtStart = this.phase;
      try {
        const res = await fetch('/api/validate-speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: clean, mode }),
        });
        if (res.ok) {
          const validation = (await res.json()) as {
            isValid: boolean;
            extractedValue: string;
          };
          // Ignore if another speech validation superseded this one or phase changed
          if (seq !== this.speechValidationSeq || this.phase !== phaseAtStart) {
            return;
          }
          if (!validation.isValid || !validation.extractedValue?.trim()) {
            this.speechIn.notifyHesitationIgnored(
              clean,
              this.getPatientListeningHint()
            );
            return;
          }
          finalValue = validation.extractedValue.trim();
        }
      } catch {
        // Fallback to local cleaned string if offline
      }
    }

    // Validated! Stop listening and act on the clean extracted entity.
    this.speechIn.stopListening();

    if (this.phase === 'ASK_PLAYER_NAME') {
      void this.handlePlayerNameCaptured(finalValue);
      return;
    }

    if (this.gameMode === 'FLYING_TRAIN') {
      void this.loadTrainCannonWithVoiceAmmo(finalValue);
      return;
    }

    if (this.phase === 'SUMMON_PROMPT' || !this.currentCharacter) {
      void this.beginMagicCloudCharacterSummon(finalValue);
    } else if (
      this.phase === 'ADDING_INGREDIENTS' ||
      this.phase === 'GUEST_GREETING'
    ) {
      void this.spawnCustomVoiceIngredient(finalValue);
    } else if (this.phase === 'BUBBLE_FINALE') {
      // Allow shouting a new ingredient or character anytime!
      this.resetSoupWithCurrentGuest();
      void this.spawnCustomVoiceIngredient(finalValue);
    }
  }

  /**
   * Starts the "Magic Cloud Ritual" while Gemini generates the character!
   */
  private async beginMagicCloudCharacterSummon(speechPrompt: string): Promise<void> {
    this.phase = 'MAGIC_CLOUD_RITUAL';
    this.magicCloudProgress = 0.08;
    this.setBanner(`✨ Wave at the Cloud!`);

    // Kick off backend generation in parallel with the child waving at the cloud
    this.pendingCharacterPromise = fetch('/api/summon-character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: speechPrompt,
        playerName: this.playerName,
      }),
    })
      .then(async (r) => {
        const data = (await r.json()) as {
          character: CharacterItem;
          pantry: PantryData;
        };
        if (data.pantry) {
          this.pantryData = data.pantry;
          this.pantryUI.renderPantry(this.pantryData);
        }
        await loadStickerImage(data.character.imageUrl);
        // Prefetch the character's greeting while the child is still waving at the Magic Cloud!
        speechOut.prefetch(data.character.greeting, {
          voiceName: data.character.voiceName,
          style: data.character.voiceStyle,
          pitch: data.character.voicePitch,
        });
        return data.character;
      })
      .catch(() => this.pantryData.characters[0]);

    void speechOut.speak(
      `Ooh, ${speechPrompt}! Wave your hands on the Magic Cloud to wake up your friend, ${this.chefTitle}!`,
      {
        voiceName: 'Kore',
        style: 'magical and encouraging',
      }
    );
  }

  private async completeCharacterSummon(character: CharacterItem): Promise<void> {
    this.currentCharacter = character;
    this.soupColor = character.themeColor;
    this.phase = 'GUEST_GREETING';
    this.resolvedEvaluation = null;
    this.pendingEvaluationPromise = null;

    const layout = this.renderer.getLayout(this.canvas.width, this.canvas.height);
    sfx.playCharacterAppear();
    this.physics.spawnSparkles(layout.charX, layout.charY, 45, [
      character.themeColor,
      '#facc15',
      '#ffffff',
    ]);

    // Personalize greeting with playerName if the character used "Little Chef"
    const personalizedGreeting = this.playerName
      ? character.greeting.replace(/Little Chef/gi, this.chefTitle)
      : character.greeting;

    this.setBanner(`${character.emoji} ${character.name}!`);

    // Prefetch narrator prompt for Ingredient #1 and the "Mix, mix, mix!" chant in parallel
    speechOut.prefetch(
      `Ingredient number 1, ${this.chefTitle}! What should we put in the magic soup?`,
      {
        voiceName: 'Kore',
        style: 'cheerful and curious',
      }
    );
    speechOut.prefetch('Mix, mix, mix!', {
      voiceName: character.voiceName,
      style: 'rhythmic, excited, playful chant for a 4-year-old',
      pitch: character.voicePitch,
    });

    const completed = await speechOut.speak(personalizedGreeting, {
      voiceName: character.voiceName,
      style: character.voiceStyle,
      pitch: character.voicePitch,
    });
    if (!completed || this.phase !== 'GUEST_GREETING') return;

    await this.promptForNextIngredient();
  }

  private selectCharacterFromShelf(char: CharacterItem): void {
    this.speechIn.stopListening();
    speechOut.stop();

    if (this.gameMode === 'FLYING_TRAIN') {
      this.currentCharacter = char;
      sfx.playTrainWhistle();
      this.physics.spawnSparkles(
        this.physics.trainState.x,
        this.physics.trainState.y - 30,
        32,
        [char.themeColor, '#facc15', '#ffffff']
      );
      this.setBanner(`🚂 Co-Pilot ${char.emoji} ${char.name}!`);
      void speechOut.speak(
        `Choo-choo, ${this.captainTitle}! I'm your Co-Pilot ${char.name}! Let's blast those clouds!`,
        {
          voiceName: char.voiceName,
          style: char.voiceStyle,
          pitch: char.voicePitch,
        }
      );
      return;
    }

    this.potIngredients = [];
    this.physics.floatingIngredients = [];
    this.physics.burpBubbles = [];
    this.activeReaction = null;
    this.resolvedEvaluation = null;
    this.pendingEvaluationPromise = null;
    void this.completeCharacterSummon(char);
  }

  /**
   * Phase 2: Prompt the child for Ingredient 1, 2, or 3 and auto-listen!
   */
  private async promptForNextIngredient(): Promise<void> {
    if (this.potIngredients.length >= 3) {
      await this.startStirringPhase();
      return;
    }

    this.phase = 'ADDING_INGREDIENTS';
    const nextNum = this.potIngredients.length + 1;

    this.setBanner(`🍲 Ingredient #${nextNum}!`);

    if (this.physics.floatingIngredients.length === 0) {
      const completed = await speechOut.speak(
        `Ingredient number ${nextNum}, ${this.chefTitle}! What should we put in the magic soup?`,
        {
          voiceName: 'Kore',
          style: 'cheerful and curious',
        }
      );

      if (
        completed &&
        this.phase === 'ADDING_INGREDIENTS' &&
        this.physics.floatingIngredients.length === 0
      ) {
        void this.speechIn.startListening(25000);
      }
    }
  }

  /**
   * Spawns a Mystery Bubble immediately that the toddler can bat around,
   * then upgrades it into the `gemini-3.1-flash-lite-image` sticker (~3s)!
   */
  private async spawnCustomVoiceIngredient(speechPrompt: string): Promise<void> {
    this.phase = 'ADDING_INGREDIENTS';

    const tempItem: IngredientItem = {
      id: `temp-${Date.now()}`,
      name: speechPrompt,
      category: 'magic',
      splashColor: '#facc15',
      characterComment: `Ooh! ${speechPrompt}, ${this.chefTitle}!`,
      emoji: '🪄',
      imageUrl: '',
      createdAt: Date.now(),
    };

    // Prefetch fallback comment immediately just in case child swats the mystery bubble right away
    if (this.currentCharacter) {
      speechOut.prefetch(tempItem.characterComment, {
        voiceName: this.currentCharacter.voiceName,
        style: this.currentCharacter.voiceStyle,
        pitch: this.currentCharacter.voicePitch,
      });
    }

    const mysteryFlt = this.physics.addFloatingIngredient(
      tempItem,
      this.canvas.width,
      this.canvas.height,
      true
    );
    sfx.playMagicChime(0.6);

    this.setBanner(`🪄 Making "${speechPrompt}"...`);

    try {
      const res = await fetch('/api/spawn-ingredient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: speechPrompt,
          characterName: this.currentCharacter?.name || 'Friend',
          playerName: this.playerName,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ingredient: IngredientItem;
          pantry: PantryData;
        };
        if (data.pantry) {
          this.pantryData = data.pantry;
          this.pantryUI.renderPantry(this.pantryData);
        }
        // Prefetch the character's reaction comment while the bubble is still floating!
        if (this.currentCharacter) {
          speechOut.prefetch(data.ingredient.characterComment, {
            voiceName: this.currentCharacter.voiceName,
            style: this.currentCharacter.voiceStyle,
            pitch: this.currentCharacter.voicePitch,
          });
        }
        this.physics.upgradeMysteryIngredient(mysteryFlt.uid, data.ingredient);

        // If the child already swatted the bubble into the pot while it was generating, upgrade the pot item too!
        const potIdx = this.potIngredients.findIndex(
          (p) => p.id === tempItem.id
        );
        if (potIdx !== -1) {
          this.potIngredients[potIdx] = data.ingredient;
          this.soupColor = data.ingredient.splashColor;
          void loadStickerImage(data.ingredient.imageUrl);
        } else if (this.phase === 'ADDING_INGREDIENTS') {
          this.setBanner(`✋ Swat ${data.ingredient.emoji} ${data.ingredient.name}!`);
        }
      }
    } catch {
      mysteryFlt.isMysteryBubble = false;
    }
  }

  private spawnIngredientFromShelf(ing: IngredientItem): void {
    this.speechIn.stopListening();
    if (!this.currentCharacter && this.pantryData.characters.length > 0) {
      this.currentCharacter = this.pantryData.characters[0];
    }

    if (this.gameMode === 'FLYING_TRAIN') {
      speechOut.stop();
      this.activeTrainAmmo = ing;
      this.phase = 'TRAIN_BLASTING_SKY';
      sfx.playTrainWhistle();

      const hasActiveClouds = this.physics.skyTargets.some(
        (t) => t.state === 'grumpy' || t.state === 'boss_pinata'
      );
      if (!hasActiveClouds) {
        this.physics.spawnSkyTargetWave(this.canvas.width, this.canvas.height);
      }

      this.setBanner(`🚂 Blast with ${ing.emoji} ${ing.name}!`);
      void speechOut.speak(
        `Choo-choo! ${ing.name} loaded into the smokestack cannon! Point at the grumpy clouds to blast them, ${this.captainTitle}!`,
        {
          voiceName: this.currentCharacter?.voiceName || 'Kore',
          style: 'excited, playful, and energetic',
          pitch: this.currentCharacter?.voicePitch || 1.05,
        }
      );
      return;
    }

    if (this.phase !== 'ADDING_INGREDIENTS') {
      if (this.potIngredients.length >= 3) {
        this.potIngredients = [];
      }
      this.phase = 'ADDING_INGREDIENTS';
    }

    // Immediately prefetch TTS audio for this ingredient's splash reaction while it floats!
    if (this.currentCharacter) {
      speechOut.prefetch(ing.characterComment, {
        voiceName: this.currentCharacter.voiceName,
        style: this.currentCharacter.voiceStyle,
        pitch: this.currentCharacter.voicePitch,
      });
    }

    this.physics.addFloatingIngredient(
      ing,
      this.canvas.width,
      this.canvas.height,
      false
    );
    sfx.playBoing();
    this.setBanner(`✋ Swat ${ing.emoji} ${ing.name}!`);
  }

  private async onIngredientDroppedInPot(item: IngredientItem): Promise<void> {
    if (this.potIngredients.length >= 3) return;

    this.potIngredients.push(item);
    this.soupColor = item.splashColor;

    // Instant visual & sound reaction on the character when an ingredient splashes in!
    const layout = this.renderer.getLayout(this.canvas.width, this.canvas.height);
    this.activeReaction = 'delicious';
    this.reactionStartTime = performance.now();
    this.physics.spawnSparkles(layout.charX, layout.charY, 24, [
      item.splashColor,
      '#facc15',
      '#ffffff',
    ]);

    this.setBanner(`💦 ${item.emoji} Splash! (${this.potIngredients.length}/3)`);

    if (this.potIngredients.length >= 3) {
      // 3rd ingredient dropped! Enter stirring phase immediately (0ms delay) while character speaks!
      this.physics.floatingIngredients = [];
      if (this.currentCharacter) {
        void speechOut.speak(item.characterComment, {
          voiceName: this.currentCharacter.voiceName,
          style: this.currentCharacter.voiceStyle,
          pitch: this.currentCharacter.voicePitch,
        });
      }
      await this.startStirringPhase(true);
      return;
    }

    // Prefetch the next ingredient narrator prompt while character reaction plays
    const nextNum = this.potIngredients.length + 1;
    speechOut.prefetch(
      `Ingredient number ${nextNum}, ${this.chefTitle}! What should we put in the magic soup?`,
      {
        voiceName: 'Kore',
        style: 'cheerful and curious',
      }
    );

    let completed = true;
    if (this.currentCharacter) {
      completed = await speechOut.speak(item.characterComment, {
        voiceName: this.currentCharacter.voiceName,
        style: this.currentCharacter.voiceStyle,
        pitch: this.currentCharacter.voicePitch,
      });
    }

    if (!completed || this.phase !== 'ADDING_INGREDIENTS') {
      return;
    }

    this.activeReaction = null;

    if (this.physics.floatingIngredients.length === 0) {
      await this.promptForNextIngredient();
    }
  }

  /**
   * Pre-computes the Gemini soup evaluation & prefetches its TTS audio
   * while the child is stirring the pot and pushing the spoon!
   */
  private async preEvaluateSoup(): Promise<SoupEvaluation> {
    if (!this.currentCharacter) {
      return this.buildInstantLocalEvaluation();
    }
    try {
      const res = await fetch('/api/evaluate-soup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: this.currentCharacter,
          ingredients: this.potIngredients,
          playerName: this.playerName,
        }),
      });
      const data = (await res.json()) as { evaluation: SoupEvaluation };
      this.resolvedEvaluation = data.evaluation;

      // Immediately prefetch the character's taste reaction audio AND burp finale audio!
      speechOut.prefetch(data.evaluation.characterLine, {
        voiceName: this.currentCharacter.voiceName,
        style: this.currentCharacter.voiceStyle,
        pitch: this.currentCharacter.voicePitch,
      });
      speechOut.prefetch(
        'Excuse me! BUUURP! Pop all the magic bubbles with your hands!',
        {
          voiceName: this.currentCharacter.voiceName || 'Puck',
          style: 'giggly and silly',
        }
      );

      return data.evaluation;
    } catch {
      const fallback = this.buildInstantLocalEvaluation();
      this.resolvedEvaluation = fallback;
      return fallback;
    }
  }

  /**
   * Instant synchronous 0ms soup evaluation based on ingredient categories
   * so the character NEVER waits for a network request when the spoon touches their mouth!
   */
  private buildInstantLocalEvaluation(): SoupEvaluation {
    const cats = this.potIngredients.map((i) => i.category);
    const names = this.potIngredients.map((i) => i.name).join(' & ');
    let reactionType: ReactionType = 'delicious';
    let characterLine = `<laugh> YUMMM, ${this.chefTitle}! This ${names} soup is super delicious!`;
    let effectColors = ['#f472b6', '#38bdf8', '#facc15'];

    if (cats.includes('spicy')) {
      reactionType = 'spicy';
      characterLine = `<gasp> WHOA, ${this.chefTitle}! Hot hot hot! Spicy dragon soup!`;
      effectColors = ['#ef4444', '#f97316', '#facc15'];
    } else if (cats.includes('icy')) {
      reactionType = 'freezing';
      characterLine = `<shiver> BRRRR, ${this.chefTitle}! My tummy just turned into an ice cube!`;
      effectColors = ['#38bdf8', '#e0f2fe', '#818cf8'];
    } else if (cats.includes('silly')) {
      reactionType = 'yucky';
      characterLine = `<laugh> BLEH! Haha ${this.chefTitle}, that tastes super silly and tickly!`;
      effectColors = ['#4ade80', '#a855f7', '#facc15'];
    } else if (cats.includes('magic')) {
      reactionType = 'balloon';
      characterLine = `<laugh> Wheeee, ${this.chefTitle}! This magic soup is making me float like a balloon!`;
      effectColors = ['#a855f7', '#38bdf8', '#f472b6'];
    } else if (cats.includes('crunchy')) {
      reactionType = 'giant';
      characterLine = `<laugh> CRUNCH CRUNCH! Look how BIG and strong I grew, ${this.chefTitle}!`;
      effectColors = ['#facc15', '#4ade80', '#fb923c'];
    }

    return {
      soupName: `${this.chefTitle}'s ${this.potIngredients[0]?.name || 'Magic'} Soup`,
      reactionType,
      characterLine,
      narratorLine: 'Pop all the burp bubbles with your hands!',
      soupColor: this.soupColor,
      effectColors,
      burpBubbleCount: 25,
    };
  }

  /**
   * Phase 3: Stir the Cauldron with Big Arm Circles!
   */
  private async startStirringPhase(keepCurrentSpeech = false): Promise<void> {
    this.speechIn.stopListening();
    this.phase = 'STIRRING_POT';
    this.stirProgress = 0;
    this.lastMixChantTime = 0;
    this.resolvedEvaluation = null;

    // Immediately kick off soup evaluation + TTS prefetch in the background while stirring!
    this.pendingEvaluationPromise = this.preEvaluateSoup();

    // Prefetch the "Mix, mix, mix!" chant AND the feeding spoon narrator prompt so both start at 0ms!
    speechOut.prefetch('Mix, mix, mix!', {
      voiceName: this.currentCharacter?.voiceName || 'Kore',
      style: 'rhythmic, excited, playful chant for a 4-year-old',
      pitch: this.currentCharacter?.voicePitch || 1.1,
    });
    const charName = this.currentCharacter?.name || 'your friend';
    speechOut.prefetch(
      `The magic soup is ready, ${this.chefTitle}! Push the big glowing spoon to ${charName}'s mouth!`,
      {
        voiceName: 'Kore',
        style: 'playful and suspenseful',
      }
    );

    this.setBanner(`🥄 MIX, MIX, MIX!`);

    if (!keepCurrentSpeech) {
      void speechOut.speak('Mix, mix, mix!', {
        voiceName: this.currentCharacter?.voiceName || 'Kore',
        style: 'rhythmic, excited, playful chant for a 4-year-old',
        pitch: this.currentCharacter?.voicePitch || 1.1,
      });
      this.lastMixChantTime = performance.now();
    }
  }

  /**
   * Phase 4: Feed the Spoon & Trigger the Slapstick Transformation!
   */
  private async startFeedingSpoonPhase(): Promise<void> {
    this.phase = 'FEEDING_SPOON';
    this.activeReaction = null;
    const layout = this.renderer.getLayout(this.canvas.width, this.canvas.height);
    this.physics.startFeedingSpoon(layout.cauldronX, layout.cauldronRimY);
    sfx.playCharacterAppear();

    const charName = this.currentCharacter?.name || 'your friend';
    this.setBanner(`🥄 Feed ${charName}!`);

    void speechOut.speak(
      `The magic soup is ready, ${this.chefTitle}! Push the big glowing spoon to ${charName}'s mouth!`,
      {
        voiceName: 'Kore',
        style: 'playful and suspenseful',
      }
    );
  }

  private async triggerTasteTestReaction(): Promise<void> {
    if (!this.currentCharacter) return;
    this.phase = 'TASTE_REACTION';

    // Stop any narrator prompt (and cancel any in-flight narrator TTS) immediately so the character reacts right now!
    speechOut.stop();

    // Use the pre-evaluated soup immediately (0ms delay!), or instant local evaluation if still in flight
    const evaluation =
      this.resolvedEvaluation || this.buildInstantLocalEvaluation();

    // Trigger visual transformation, sound effects, and sparkles on the EXACT frame the spoon touches!
    this.activeReaction = evaluation.reactionType;
    this.reactionStartTime = performance.now();
    this.soupColor = evaluation.soupColor || this.soupColor;

    const layout = this.renderer.getLayout(this.canvas.width, this.canvas.height);
    sfx.playReactionSound(evaluation.reactionType);
    this.physics.spawnSparkles(
      layout.charX,
      layout.charY,
      65,
      evaluation.effectColors
    );

    this.setBanner(`🌟 ${evaluation.soupName}!`);

    const completed = await speechOut.speak(evaluation.characterLine, {
      voiceName: this.currentCharacter.voiceName,
      style: this.currentCharacter.voiceStyle,
      pitch: this.currentCharacter.voicePitch,
    });

    if (!completed || this.phase !== 'TASTE_REACTION') return;

    // Phase 5: Launch the Bubble Burp Finale!
    this.startBubbleBurpFinale(evaluation);
  }

  private startBubbleBurpFinale(evaluation: SoupEvaluation): void {
    this.phase = 'BUBBLE_FINALE';
    const layout = this.renderer.getLayout(this.canvas.width, this.canvas.height);

    sfx.playCartoonBurp();
    this.physics.spawnBurpBubbles(
      evaluation.burpBubbleCount || 25,
      layout.charX,
      layout.charY,
      this.canvas.width,
      this.canvas.height,
      this.potIngredients,
      evaluation.effectColors
    );

    this.setBanner(`🫧 POP THE BUBBLES!`);

    void speechOut.speak(
      'Excuse me! BUUURP! Pop all the magic bubbles with your hands!',
      {
        voiceName: this.currentCharacter?.voiceName || 'Puck',
        style: 'giggly and silly',
      }
    );
  }

  private onAllBubblesPopped(): void {
    if (this.gameMode === 'FLYING_TRAIN') {
      sfx.playTrainWhistle();
      this.setBanner(`🎉 YAY! All Popped!`);

      window.setTimeout(() => {
        if (
          this.gameMode === 'FLYING_TRAIN' &&
          this.phase === 'TRAIN_BUBBLE_PARTY'
        ) {
          void this.startFlyingTrainRound(true);
        }
      }, 2800);
      return;
    }

    sfx.playCharacterAppear();
    this.setBanner(`🎉 YAY! All Popped!`);

    window.setTimeout(() => {
      if (this.phase === 'BUBBLE_FINALE') {
        this.resetSoupWithCurrentGuest();
      }
    }, 2800);
  }

  private resetSoupWithCurrentGuest(): void {
    this.speechIn.stopListening();
    speechOut.stop();
    this.potIngredients = [];
    this.physics.floatingIngredients = [];
    this.physics.burpBubbles = [];
    this.physics.spoonPos.active = false;
    this.activeReaction = null;

    if (this.currentCharacter) {
      void this.promptForNextIngredient();
    } else {
      void this.startSummonPrompt();
    }
  }

  // ============================================================================
  // 🚂🌈 GAME MODE 2: THE RAINBOW CLOUD BLASTER ("FLYING TRAIN THAT SHOOTS")
  // ============================================================================

  private async startFlyingTrainRound(askForNewAmmo: boolean): Promise<void> {
    this.speechIn.stopListening();
    speechOut.stop();

    if (!this.currentCharacter && this.pantryData.characters.length > 0) {
      this.currentCharacter = this.pantryData.characters[0];
    }
    if (!this.activeTrainAmmo && this.pantryData.ingredients.length > 0) {
      this.activeTrainAmmo = this.pantryData.ingredients[0];
    }

    this.physics.burpBubbles = [];
    this.physics.spawnSkyTargetWave(this.canvas.width, this.canvas.height);
    sfx.playTrainWhistle();

    // Prefetch the co-pilot "Choo-choo! Blast, blast, blast!" chant
    speechOut.prefetch('Choo-choo! Blast, blast, blast!', {
      voiceName: this.currentCharacter?.voiceName || 'Kore',
      style: 'rhythmic, joyful, excited chant for a 4-year-old',
      pitch: this.currentCharacter?.voicePitch || 1.1,
    });

    if (askForNewAmmo) {
      this.phase = 'TRAIN_PICK_AMMO';
      this.setBanner(`🚂 What should we shoot?`);

      const completed = await speechOut.speak(
        `All aboard the Rainbow Sky Train, ${this.captainTitle}! What silly thing should our train cannon shoot today? Shout it out, or wave your hands to start blasting!`,
        {
          voiceName: 'Kore',
          style: 'excited, magical, playful storybook narrator speaking to a 4-year-old',
        }
      );

      if (
        completed &&
        this.gameMode === 'FLYING_TRAIN' &&
        (this.phase === 'TRAIN_PICK_AMMO' || this.phase === 'TRAIN_BLASTING_SKY')
      ) {
        void this.speechIn.startListening(25000);
      }
    } else {
      this.phase = 'TRAIN_BLASTING_SKY';
      const ammoName = this.activeTrainAmmo?.name || 'Cupcakes';
      const ammoEmoji = this.activeTrainAmmo?.emoji || '🧁';
      this.setBanner(`🚂 Blast with ${ammoEmoji} ${ammoName}!`);

      void speechOut.speak(
        `Choo-choo! Look at those grumpy storm clouds, ${this.captainTitle}! Point your hands at the sky to blast them into happy rainbow clouds!`,
        {
          voiceName: 'Kore',
          style: 'cheerful and energetic',
        }
      );
    }
  }

  /**
   * Loads the Flying Train's Smokestack Cannon with whatever the child shouted!
   * Immediately equips a Mystery Ammo Ball (0ms delay) so the child can shoot right away,
   * then upgrades all projectiles in flight + future shots once `gemini-3.1-flash-lite-image` finishes (~2.45s).
   */
  private async loadTrainCannonWithVoiceAmmo(
    speechPrompt: string
  ): Promise<void> {
    this.phase = 'TRAIN_BLASTING_SKY';

    const tempAmmo: IngredientItem = {
      id: `temp-ammo-${Date.now()}`,
      name: speechPrompt,
      category: 'magic',
      splashColor: '#facc15',
      characterComment: `Choo-choo! Blasting ${speechPrompt}, ${this.captainTitle}!`,
      emoji: '🚀',
      imageUrl: '',
      createdAt: Date.now(),
    };

    this.activeTrainAmmo = tempAmmo;
    sfx.playTrainWhistle();

    const hasActiveClouds = this.physics.skyTargets.some(
      (t) => t.state === 'grumpy' || t.state === 'boss_pinata'
    );
    if (!hasActiveClouds) {
      this.physics.spawnSkyTargetWave(this.canvas.width, this.canvas.height);
    }

    this.setBanner(`🪄 Loading "${speechPrompt}"...`);

    void speechOut.speak(
      `Choo-choo! Loading ${speechPrompt} into the smokestack cannon! Blast those grumpy clouds, ${this.captainTitle}!`,
      {
        voiceName: this.currentCharacter?.voiceName || 'Kore',
        style: 'excited, playful, and celebratory',
        pitch: this.currentCharacter?.voicePitch || 1.05,
      }
    );

    try {
      const res = await fetch('/api/spawn-ingredient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: speechPrompt,
          characterName: this.currentCharacter?.name || 'Co-Pilot',
          playerName: this.playerName,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ingredient: IngredientItem;
          pantry: PantryData;
        };
        if (data.pantry) {
          this.pantryData = data.pantry;
          this.pantryUI.renderPantry(this.pantryData);
        }

        await loadStickerImage(data.ingredient.imageUrl);
        this.physics.upgradeTrainAmmo(data.ingredient);

        if (this.activeTrainAmmo?.id === tempAmmo.id) {
          this.activeTrainAmmo = data.ingredient;
        }

        if (
          this.gameMode === 'FLYING_TRAIN' &&
          this.phase === 'TRAIN_BLASTING_SKY'
        ) {
          this.setBanner(
            `🚂 Blast with ${data.ingredient.emoji} ${data.ingredient.name}!`
          );
        }
      }
    } catch {
      // Keep using tempAmmo if offline
    }
  }

  private onTrainCloudTransformed(_cloud: SkyTarget, remaining: number): void {
    const total = this.physics.trainState.totalCloudsInRound;
    const transformed = Math.max(1, total - remaining);

    if (remaining === 3) {
      // Halfway through the 6-cloud journey! Cheer and offer a mid-flight voice ammo switch!
      this.setBanner(`🌈 Halfway! (${transformed}/${total})`);
      if (!speechOut.isSpeaking()) {
        void speechOut.speak(
          `Yay, three happy rainbow clouds, ${this.captainTitle}! Three more grumpy clouds are floating in! Keep blasting, or shout a new silly thing to shoot!`,
          {
            voiceName: 'Kore',
            style: 'cheerful, encouraging, and excited',
          }
        );
      }
    } else if (remaining > 0) {
      this.setBanner(`🌈 Happy Cloud! (${transformed}/${total})`);
    }
  }

  private onTrainBossSpawned(): void {
    sfx.playTrainWhistle();
    this.setBanner(`🎁 Blast the Pinata Cloud!`);

    void speechOut.speak(
      `Whoa, ${this.captainTitle}! Look! All six clouds are happy, and here comes the Giant Golden Pinata Cloud! Blast it six times to burst it open!`,
      {
        voiceName: 'Kore',
        style: 'thrilled, dramatic, and super excited',
      }
    );
  }

  private onTrainBossPinataBurst(): void {
    this.phase = 'TRAIN_BUBBLE_PARTY';
    sfx.playReactionSound('balloon');
    sfx.playTrainWhistle();

    const prizeItems = this.activeTrainAmmo
      ? [this.activeTrainAmmo]
      : this.pantryData.ingredients.slice(0, 3);

    this.physics.spawnBurpBubbles(
      14,
      this.canvas.width * 0.58,
      this.canvas.height * 0.42,
      this.canvas.width,
      this.canvas.height,
      prizeItems,
      ['#f472b6', '#facc15', '#4ade80', '#38bdf8', '#c084fc']
    );

    this.setBanner(`🫧 POP THE BUBBLES!`);

    void speechOut.speak(
      `Hooray, ${this.captainTitle}! You burst the Giant Pinata Cloud! Pop all the rainbow prize bubbles with your hands!`,
      {
        voiceName: this.currentCharacter?.voiceName || 'Kore',
        style: 'joyful, celebratory, and giggly',
        pitch: this.currentCharacter?.voicePitch || 1.1,
      }
    );
  }

  /**
   * Main 60 FPS AR Mirror Update & Render Loop
   */
  private loop(timestamp: number): void {
    const dt = Math.min(0.05, (timestamp - this.lastFrameTime) / 1000);
    this.lastFrameTime = timestamp;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const layout = this.renderer.getLayout(w, h);
    const hands = this.handTracker.detectHands();

    if (this.gameMode === 'FLYING_TRAIN') {
      if (!this.activeTrainAmmo && this.pantryData.ingredients.length > 0) {
        this.activeTrainAmmo = this.pantryData.ingredients[0];
      }

      // If the child starts waving their hands vigorously during TRAIN_PICK_AMMO after the narrator finishes speaking, transition into TRAIN_BLASTING_SKY
      if (
        this.phase === 'TRAIN_PICK_AMMO' &&
        !speechOut.isSpeaking() &&
        hands.some((hand) => Math.hypot(hand.vx, hand.vy) > 0.36)
      ) {
        this.phase = 'TRAIN_BLASTING_SKY';
      }

      const isBlastingPhase = this.phase === 'TRAIN_BLASTING_SKY';

      // Play occasional "Choo-choo! Blast, blast, blast!" cheer when the child is actively blasting and no voice is speaking
      const isBlastingActively =
        isBlastingPhase &&
        hands.some((hand) => Math.hypot(hand.vx, hand.vy) > 0.25);

      if (
        isBlastingActively &&
        !speechOut.isSpeaking() &&
        timestamp - this.lastTrainChantTime > 8500
      ) {
        this.lastTrainChantTime = timestamp;
        void speechOut.speak('Choo-choo! Blast, blast, blast!', {
          voiceName: this.currentCharacter?.voiceName || 'Kore',
          style: 'rhythmic, joyful, excited chant for a 4-year-old',
          pitch: this.currentCharacter?.voicePitch || 1.1,
        });
      }

      this.physics.updateFlyingTrain(
        dt,
        w,
        h,
        hands,
        this.activeTrainAmmo,
        isBlastingPhase,
        (cloud: SkyTarget, remaining: number) =>
          this.onTrainCloudTransformed(cloud, remaining),
        () => this.onTrainBossSpawned(),
        () => this.onTrainBossPinataBurst(),
        () => this.onAllBubblesPopped()
      );
    } else {
      // Update Phase-Specific Hand Gestures (Magic Cloud Waving & Cauldron Stirring)
      if (this.phase === 'MAGIC_CLOUD_RITUAL') {
        // Gentle auto-progress so a 4-year-old never gets stuck, plus fast progress when waving hands!
        this.magicCloudProgress += dt * 0.14;

        for (const hand of hands) {
          const hx = hand.x * w;
          const hy = hand.y * h;
          const dist = Math.hypot(hx - layout.cloudX, hy - layout.cloudY);
          const speed = Math.hypot(hand.vx, hand.vy);
          if (dist < layout.cloudRadius * 1.65) {
            this.magicCloudProgress +=
              dt * (0.28 + Math.min(0.6, speed * 0.35));
            sfx.playMagicChime(this.magicCloudProgress);
            if (Math.random() < 0.4) {
              this.physics.spawnSparkles(hx, hy, 2);
            }
          }
        }

        if (this.magicCloudProgress >= 1 && this.pendingCharacterPromise) {
          this.magicCloudProgress = 1;
          const promise = this.pendingCharacterPromise;
          this.pendingCharacterPromise = null;
          void promise.then((char) => this.completeCharacterSummon(char));
        }
      } else if (this.phase === 'STIRRING_POT') {
        // Check hands moving near the cauldron
        for (const hand of hands) {
          const hx = hand.x * w;
          const hy = hand.y * h;
          const speed = Math.hypot(hand.vx, hand.vy);
          const nearPot =
            Math.abs(hx - layout.cauldronX) < layout.cauldronRadiusX * 1.45 &&
            hy > layout.cauldronRimY - 220;

          if (nearPot && speed > 0.12) {
            this.stirProgress += dt * Math.min(0.75, 0.22 + speed * 0.32);
            sfx.playStirSwirl(this.stirProgress);

            // Say "MIX, MIX, MIX!" when the player mixes the cauldron, only if no voice is currently speaking!
            if (
              !speechOut.isSpeaking() &&
              timestamp - this.lastMixChantTime > 2600
            ) {
              this.lastMixChantTime = timestamp;
              void speechOut.speak('Mix, mix, mix!', {
                voiceName: this.currentCharacter?.voiceName || 'Kore',
                style: 'rhythmic, excited, playful chant for a 4-year-old',
                pitch: this.currentCharacter?.voicePitch || 1.1,
              });
            }

            if (Math.random() < 0.5) {
              this.physics.spawnSparkles(
                layout.cauldronX + (Math.random() - 0.5) * 140,
                layout.cauldronRimY,
                2,
                [this.soupColor, '#ffffff', '#facc15'],
                'bubble'
              );
            }
          }
        }

        if (this.stirProgress >= 1) {
          this.stirProgress = 1;
          this.physics.spawnCauldronSplash(
            layout.cauldronX,
            layout.cauldronRimY,
            this.soupColor
          );
          void this.startFeedingSpoonPhase();
        }
      }

      // Update Cauldron Physics
      this.physics.update(
        dt,
        w,
        h,
        hands,
        layout.cauldronX,
        layout.cauldronRimY,
        layout.cauldronRadiusX,
        layout.charX,
        layout.charY,
        (item) => void this.onIngredientDroppedInPot(item),
        () => void this.triggerTasteTestReaction(),
        () => this.onAllBubblesPopped()
      );
    }

    // Render 60 FPS AR Mirror Frame
    this.renderer.render(
      this.video,
      this.handTracker.isWebcamReady(),
      {
        gameMode: this.gameMode,
        phase: this.phase,
        character: this.currentCharacter,
        potIngredients: this.potIngredients,
        activeTrainAmmo: this.activeTrainAmmo,
        soupColor: this.soupColor,
        magicCloudProgress: Math.min(1, this.magicCloudProgress),
        stirProgress: Math.min(1, this.stirProgress),
        activeReaction: this.activeReaction,
        reactionStartTime: this.reactionStartTime,
        hands,
      },
      this.physics
    );

    requestAnimationFrame((t) => this.loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SillyChefGame();
});
