import { GoogleGenAI, Type } from '@google/genai';
import type {
  CharacterItem,
  IngredientItem,
  ReactionType,
  SoupEvaluation,
} from '../src/types.ts';
import {
  createStarterCharacterSvg,
  createStarterIngredientSvg,
  pantryStore,
} from './pantryStore.ts';

import { execFileSync } from 'node:child_process';

const BRAIN_MODEL = process.env.GEMINI_BRAIN_MODEL || 'gemini-3.8-flash';
const FAST_BRAIN_MODEL =
  process.env.GEMINI_FAST_BRAIN_MODEL || 'gemini-3.5-flash-lite';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1';
const FAST_IMAGE_MODEL =
  process.env.GEMINI_FAST_IMAGE_MODEL || 'gemini-3.1-flash-lite-image';
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts';
const TRANSCRIBE_MODEL =
  process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe';

/** The models this server actually calls, as reported by `/api/status`. */
export const geminiModels = {
  brain: BRAIN_MODEL,
  fastBrain: FAST_BRAIN_MODEL,
  image: IMAGE_MODEL,
  fastImage: FAST_IMAGE_MODEL,
  tts: TTS_MODEL,
  transcribe: TRANSCRIBE_MODEL,
} as const;

let cachedApiKey: string | null | undefined;

function resolveGeminiApiKey(): string | null {
  if (cachedApiKey !== undefined) {
    return cachedApiKey;
  }

  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey && envKey !== 'your_gemini_api_key_here') {
    cachedApiKey = envKey;
    return cachedApiKey;
  }

  // On Windows, also check User and Machine environment variables in case the IDE was opened before the variable was set
  if (process.platform === 'win32') {
    try {
      // Windows PowerShell 5.1 (`powershell`) has no `??` operator, so fall back with an explicit `if`
      const winKey = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "$v = [Environment]::GetEnvironmentVariable('GEMINI_API_KEY', 'User'); if (-not $v) { $v = [Environment]::GetEnvironmentVariable('GEMINI_API_KEY', 'Machine') }; $v",
        ],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (winKey && winKey !== 'your_gemini_api_key_here') {
        process.env.GEMINI_API_KEY = winKey;
        cachedApiKey = winKey;
        return cachedApiKey;
      }
    } catch {
      // Ignore registry lookup errors
    }
  }

  cachedApiKey = null;
  return null;
}

function getClient(): GoogleGenAI | null {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

export function isGeminiConfigured(): boolean {
  return getClient() !== null;
}

/**
 * Generates a die-cut cartoon sticker PNG using `gemini-3.1-flash-lite-image`
 * (or `gemini-nano-banana-2.1` fallback) with `responseModalities: ['IMAGE']` for maximum speed (~3s).
 */
async function generateStickerBase64(
  ai: GoogleGenAI,
  subjectPrompt: string
): Promise<string | null> {
  const fullPrompt = `${subjectPrompt}. Style: Cute 2D cartoon die-cut sticker for a 4-year-old children's game, bold clean outlines, thick white sticker border around the character/object, centered, isolated on a solid pure white (#FFFFFF) background. No text, no watermarks, vibrant cheerful colors.`;

  // Prioritize gemini-3.1-flash-lite-image for fast interactive sticker generation
  const modelsToTry = [FAST_IMAGE_MODEL, IMAGE_MODEL];

  for (const model of modelsToTry) {
    try {
      // 1. Fastest path (~3.0s): generateContent with responseModalities: ['IMAGE'] (no text token overhead)
      const response = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: {
          responseModalities: ['IMAGE'],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (
          part.inlineData?.data &&
          part.inlineData.mimeType?.startsWith('image/')
        ) {
          return part.inlineData.data;
        }
      }

      // 2. Fallback to Interactions API (ai.interactions.create)
      const anyAi = ai as unknown as {
        interactions?: {
          create: (req: Record<string, unknown>) => Promise<{
            output_image?: { data?: string };
          }>;
        };
      };

      if (anyAi.interactions && typeof anyAi.interactions.create === 'function') {
        const interaction = await anyAi.interactions.create({
          model,
          input: fullPrompt,
        });
        if (interaction?.output_image?.data) {
          return interaction.output_image.data;
        }
      }
    } catch (err) {
      console.warn(`[Gemini Image] Model ${model} attempt failed:`, err);
    }
  }

  return null;
}

/**
 * Helper to run ultra-fast structured JSON generation (`~0.5s`) with `gemini-3.5-flash-lite`
 * and fallback to `gemini-3.8-flash`. Do not pass `thinkingConfig`: `gemini-3.5-flash-lite` is a
 * non-thinking model and rejects it with 400 INVALID_ARGUMENT, silently forcing every call onto the fallback.
 */
async function generateStructuredJson<T>(
  ai: GoogleGenAI,
  prompt: string,
  schema: Record<string, unknown>
): Promise<T> {
  const models = [FAST_BRAIN_MODEL, BRAIN_MODEL];
  let lastError: unknown;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.7,
        },
      });
      const text = response.text || '{}';
      return JSON.parse(text) as T;
    } catch (err) {
      console.warn(`[Gemini Brain] Model ${model} failed:`, err);
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Fast toddler speech intent validator & entity extractor.
 * Rejects hesitations, interjections ("umm", "wait", "great", "you say it", "I don't know", etc.)
 * and extracts only an actual player name, guest character, or food/silly object!
 */
export interface SpeechValidationResult {
  isValid: boolean;
  extractedValue: string;
  reason?: string;
}

const PURE_FILLER_REGEX =
  /^(um+|uh+|er+|erm+|hm+|ah+|oh+|ooh+|huh|well|like|so|wait|hold on|hang on|one second|a second|let me think|let me see|i don'?t know|dunno|not sure|you say it|you pick|you choose|you do it|what should i say|what do i say|tell me|help me|yes|yeah|yep|no|nope|not yet|okay|ok|great|good|cool|awesome|nice|yay|wow|sure|alright|fine|thank you|thanks|please|hi|hello|hey|what|who|why|where|how|mama|mommy|mom|dada|daddy|dad|papa|maybe|nothing|anything|something|\s)+$/i;

export async function validateAndExtractToddlerSpeech(
  userSpeech: string,
  mode: 'player_name' | 'character' | 'ingredient'
): Promise<SpeechValidationResult> {
  const raw = userSpeech
    .replace(/[.!?,"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw || raw.length < 2 || PURE_FILLER_REGEX.test(raw)) {
    return {
      isValid: false,
      extractedValue: '',
      reason: 'Hesitation or interjection only',
    };
  }

  const ai = getClient();
  if (!ai) {
    // Offline fallback extraction
    const stripped = raw
      .replace(
        /^(um+|uh+|hm+|oh+|ah+|well|wait|hold on|okay|ok|great|yes|yeah|so|like|maybe|i want|i would like|can we have|how about|let's do|lets do|my name is|i am|i'm|im|call me)\s+/gi,
        ''
      )
      .replace(/\s+(please|thank you|thanks)$/gi, '')
      .trim();
    if (!stripped || PURE_FILLER_REGEX.test(stripped)) {
      return { isValid: false, extractedValue: '' };
    }
    return { isValid: true, extractedValue: stripped };
  }

  try {
    const modeInstructions =
      mode === 'player_name'
        ? `We asked a 4-year-old child "What is your name?".
Return isValid: true ONLY if the transcript contains an actual person's name, nickname, or playful title (e.g. "Leo", "umm my name is Maya" -> "Maya", "Super Max" -> "Super Max").
Return isValid: false if the child is just hesitating, reacting, asking someone else to speak, or saying filler/interjections (e.g. "umm", "great", "wait", "you say it", "I don't know", "no", "what", "daddy you say it", "hold on").`
        : mode === 'character'
          ? `We asked a 4-year-old child "Who is coming to eat our magic soup today?".
Return isValid: true ONLY if the transcript mentions an actual character, animal, creature, person, superhero, or silly guest entity (e.g. "umm wait a purple dinosaur" -> "a purple dinosaur", "Spiderman" -> "Spiderman", "a monster" -> "a monster", "fire truck" -> "fire truck").
Return isValid: false if the child is only hesitating, praising, refusing, or talking to their parent without naming a guest (e.g. "umm", "great", "wait", "you say it", "you pick", "I don't know", "who should we make", "okay", "awesome", "wait a minute").`
          : `We asked a 4-year-old child "What ingredient should we put in the magic soup?".
Return isValid: true ONLY if the transcript mentions an actual food, drink, or concrete silly physical object/thing (e.g. "strawberries" -> "strawberries", "umm wait a monster truck" -> "a monster truck", "dirty sock" -> "dirty sock", "glitter" -> "glitter", "ice cream" -> "ice cream").
Return isValid: false if the child is only hesitating, reacting, or asking their parent to choose without naming an actual food or object (e.g. "umm", "great", "wait", "you say it", "you pick one", "I don't know", "what should we put", "that was funny", "yes", "no", "hold on").`;

    const result = await generateStructuredJson<{
      isValid: boolean;
      extractedValue: string;
    }>(
      ai,
      `${modeInstructions}
Transcript heard from microphone: "${raw}"
If isValid is true, set extractedValue to the clean name/character/ingredient with all leading/trailing filler words ("umm", "uh", "wait", "I want", "my name is", "please") removed. If isValid is false, set extractedValue to "".`,
      {
        type: Type.OBJECT,
        properties: {
          isValid: {
            type: Type.BOOLEAN,
            description:
              'True ONLY if an actual name/character/ingredient was spoken, false for interjections/hesitations',
          },
          extractedValue: {
            type: Type.STRING,
            description: 'Clean extracted entity without filler words, or empty string',
          },
        },
        required: ['isValid', 'extractedValue'],
      }
    );

    const cleanedVal = (result.extractedValue || '').trim();
    if (!result.isValid || !cleanedVal || PURE_FILLER_REGEX.test(cleanedVal)) {
      return { isValid: false, extractedValue: '' };
    }
    return { isValid: true, extractedValue: cleanedVal };
  } catch {
    return { isValid: true, extractedValue: raw };
  }
}

/**
 * Summons a custom character from toddler speech (e.g., "umm a blue dinosaur with a firefighter hat!")
 */
export async function summonCharacterFromPrompt(
  userSpeech: string,
  playerName?: string
): Promise<CharacterItem> {
  const cleanSpeech = userSpeech.trim() || 'a friendly silly monster';
  const chefLabel = playerName ? `Chef ${playerName}` : 'Little Chef';

  // Check if we already have an exact match in the pantry
  const cached = pantryStore.findCachedCharacter(cleanSpeech);
  if (cached) {
    return cached;
  }

  const ai = getClient();
  if (!ai) {
    return createOfflineCharacter(cleanSpeech);
  }

  try {
    interface CharacterBrainOutput {
      name: string;
      title: string;
      description: string;
      greeting: string;
      craving: string;
      themeColor: string;
      accentColor: string;
      voiceName: string;
      voiceStyle: string;
      voicePitch: number;
      emoji: string;
    }

    // Run Brain JSON + gemini-3.1-flash-lite-image Sticker Generation IN PARALLEL!
    const [brainResult, base64Png] = await Promise.all([
      generateStructuredJson<CharacterBrainOutput>(
        ai,
        `A 4-year-old child named "${chefLabel}" playing "Silly Chef: The Magic Cauldron" was asked "Who is coming to eat our magic soup today?" and they said: "${cleanSpeech}".
Create a cute, funny, child-safe cartoon guest character based on what they said.
Address the child directly as "${chefLabel}" in the greeting!
Note: For greeting, you may include a single angle-bracket vocal tag like <laugh> or <short pause> supported by Gemini 3.8 Flash TTS, and keep the greeting short (1-2 energetic sentences suitable for a 4-year-old).
Choose voiceName from: "Puck", "Kore", "Fenrir", "Aoede", "Charon".`,
        {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Short catchy cartoon name, e.g. Barnaby' },
            title: { type: Type.STRING, description: 'Fun title, e.g. The Firefighter Dino' },
            description: { type: Type.STRING, description: 'Clean description of the character' },
            greeting: {
              type: Type.STRING,
              description: `Short enthusiastic greeting spoken directly to ${chefLabel}`,
            },
            craving: {
              type: Type.STRING,
              description: 'What kind of silly soup they want, e.g. Something crunchy and sparkly!',
            },
            themeColor: { type: Type.STRING, description: 'Hex color matching the character, e.g. #38bdf8' },
            accentColor: { type: Type.STRING, description: 'Lighter hex color for highlights, e.g. #bae6fd' },
            voiceName: { type: Type.STRING, description: 'One of Puck, Kore, Fenrir, Aoede, Charon' },
            voiceStyle: {
              type: Type.STRING,
              description: 'Gemini 3.8 TTS acting style direction, e.g. playful, bouncy cartoon dinosaur',
            },
            voicePitch: { type: Type.NUMBER, description: 'Pitch between 0.8 and 1.3' },
            emoji: { type: Type.STRING, description: 'Single best matching emoji' },
          },
          required: [
            'name',
            'title',
            'description',
            'greeting',
            'craving',
            'themeColor',
            'accentColor',
            'voiceName',
            'voiceStyle',
            'voicePitch',
            'emoji',
          ],
        }
      ),
      generateStickerBase64(
        ai,
        `Full-body cute happy hungry cartoon character: ${cleanSpeech}`
      ),
    ]);

    const imageUrl = base64Png
      ? pantryStore.saveImageBuffer('char', base64Png)
      : createStarterCharacterSvg(
          brainResult.emoji || '👾',
          brainResult.themeColor || '#8b5cf6',
          brainResult.accentColor || '#ddd6fe'
        );

    const newChar: CharacterItem = {
      id: `char-${Date.now()}`,
      name: brainResult.name || 'Silly Friend',
      title: brainResult.title || 'The Hungry Guest',
      description: brainResult.description || cleanSpeech,
      greeting:
        brainResult.greeting ||
        `<laugh> Hi ${chefLabel}! I can't wait to taste your magic soup!`,
      craving: brainResult.craving || 'Something super silly!',
      themeColor: brainResult.themeColor || '#8b5cf6',
      voiceName: brainResult.voiceName || 'Puck',
      voiceStyle:
        brainResult.voiceStyle || 'cheerful and enthusiastic cartoon character',
      voicePitch: brainResult.voicePitch || 1.05,
      emoji: brainResult.emoji || '🦖',
      imageUrl,
      createdAt: Date.now(),
    };

    pantryStore.addCharacter(newChar);
    return newChar;
  } catch (err) {
    console.error('[summonCharacterFromPrompt] Falling back to offline generator:', err);
    return createOfflineCharacter(cleanSpeech);
  }
}

/**
 * Spawns a custom ingredient sticker from toddler speech (e.g., "a rainbow monster truck!" or "strawberries")
 * Uses `gemini-3.1-flash-lite-image` in parallel with `gemini-3.5-flash-lite` for ~3s total generation time!
 */
export async function spawnIngredientFromPrompt(
  userSpeech: string,
  characterName?: string,
  playerName?: string
): Promise<IngredientItem> {
  const cleanSpeech = userSpeech.trim() || 'mystery sparkle berry';
  const chefLabel = playerName ? `Chef ${playerName}` : 'Little Chef';

  const cached = pantryStore.findCachedIngredient(cleanSpeech);
  if (cached) {
    return cached;
  }

  const ai = getClient();
  if (!ai) {
    return createOfflineIngredient(cleanSpeech);
  }

  try {
    interface IngredientBrainOutput {
      name: string;
      category: 'sweet' | 'spicy' | 'icy' | 'silly' | 'crunchy' | 'fruity' | 'magic';
      splashColor: string;
      ringColor: string;
      characterComment: string;
      emoji: string;
    }

    // Run Brain JSON + gemini-3.1-flash-lite-image Sticker Generation IN PARALLEL!
    const [brainResult, base64Png] = await Promise.all([
      generateStructuredJson<IngredientBrainOutput>(
        ai,
        `A 4-year-old child named "${chefLabel}" is making magic soup for ${characterName || 'their cartoon friend'} and shouted out this ingredient: "${cleanSpeech}".
Turn what they said into a fun, whimsical cartoon soup ingredient! Even if it's not food (like a fire truck, a shoe, a dinosaur bone, or glitter), embrace the silliness!
Keep characterComment short (1 funny sentence reacting to this ingredient going into the soup, addressing ${chefLabel} if natural, optional <laugh> tag allowed).`,
        {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Short fun ingredient name, 1-3 words' },
            category: {
              type: Type.STRING,
              description: 'One of: sweet, spicy, icy, silly, crunchy, fruity, magic',
            },
            splashColor: {
              type: Type.STRING,
              description: 'Vibrant hex color that the soup turns when this splashes in',
            },
            ringColor: {
              type: Type.STRING,
              description: 'Light pastel hex color matching splashColor',
            },
            characterComment: {
              type: Type.STRING,
              description: '1 short funny sentence the character says when this drops in the pot',
            },
            emoji: { type: Type.STRING, description: 'Single best matching emoji' },
          },
          required: [
            'name',
            'category',
            'splashColor',
            'ringColor',
            'characterComment',
            'emoji',
          ],
        }
      ),
      generateStickerBase64(
        ai,
        `Cute cartoon icon sticker of single item: ${cleanSpeech}`
      ),
    ]);

    const imageUrl = base64Png
      ? pantryStore.saveImageBuffer('ing', base64Png)
      : createStarterIngredientSvg(
          brainResult.emoji || '✨',
          brainResult.ringColor || '#fef08a'
        );

    const validCategories = [
      'sweet',
      'spicy',
      'icy',
      'silly',
      'crunchy',
      'fruity',
      'magic',
    ] as const;
    const category = validCategories.includes(brainResult.category)
      ? brainResult.category
      : 'silly';

    const newIng: IngredientItem = {
      id: `ing-${Date.now()}`,
      name: brainResult.name || cleanSpeech,
      category,
      splashColor: brainResult.splashColor || '#a855f7',
      characterComment:
        brainResult.characterComment ||
        `<laugh> Whoa, ${chefLabel}! ${brainResult.name || cleanSpeech} in my soup?!`,
      emoji: brainResult.emoji || '🌟',
      imageUrl,
      createdAt: Date.now(),
    };

    pantryStore.addIngredient(newIng);
    return newIng;
  } catch (err) {
    console.error('[spawnIngredientFromPrompt] Falling back to offline generator:', err);
    return createOfflineIngredient(cleanSpeech);
  }
}

/**
 * Evaluates the 3 ingredients in the cauldron and picks a hilarious transformation reaction!
 */
export async function evaluateSoupRecipe(
  character: CharacterItem,
  ingredients: IngredientItem[],
  playerName?: string
): Promise<SoupEvaluation> {
  const ingNames = ingredients.map((i) => `${i.name} (${i.category})`).join(', ');
  const chefLabel = playerName ? `Chef ${playerName}` : 'Little Chef';
  const ai = getClient();

  if (!ai) {
    return createOfflineSoupEvaluation(character, ingredients);
  }

  try {
    interface SoupBrainOutput {
      soupName: string;
      reactionType: ReactionType;
      characterLine: string;
      narratorLine: string;
      soupColor: string;
      effectColors: string[];
      burpBubbleCount: number;
    }

    const result = await generateStructuredJson<SoupBrainOutput>(
      ai,
      `A 4-year-old chef named "${chefLabel}" just cooked a magic potion in the cauldron for ${character.name} (${character.title}) using these 3 ingredients: ${ingNames}.
Choose the funniest, most fitting cartoon transformation reactionType from:
- "delicious": Yummy rainbow disco dance party! (Great for sweet/fruity/yummy combos)
- "spicy": Super spicy fire-breathing & steam out of ears! (Great if anything hot/spicy/red/dragon is inside)
- "freezing": Brain-freeze shivering inside a giant ice cube! (Great if ice cream/snow/cold things are inside)
- "yucky": Goofy green stinky face with silly tongue out! (Great if socks/trucks/bugs/mud/broccoli mix with weird things)
- "balloon": Puffs up round like a giant floating helium balloon! (Great for fizzy/light/airy/silly combos)
- "giant": Grows 3x huge with screen-shaking happy stomps! (Great for strong/crunchy/monster combos)

Make characterLine a super funny 1-2 sentence reaction spoken by ${character.name} to ${chefLabel} after tasting the spoon (you can use <laugh> or <short pause>).`,
      {
        type: Type.OBJECT,
        properties: {
          soupName: {
            type: Type.STRING,
            description: 'Hilarious name for this soup, e.g. Turbo Sock Berry Stew',
          },
          reactionType: {
            type: Type.STRING,
            description: 'One of: delicious, spicy, freezing, yucky, balloon, giant',
          },
          characterLine: {
            type: Type.STRING,
            description: 'What the character shouts after tasting it',
          },
          narratorLine: {
            type: Type.STRING,
            description: 'Short prompt inviting the child to pop the burp bubbles next',
          },
          soupColor: { type: Type.STRING, description: 'Hex color of the finished soup' },
          effectColors: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3 vibrant hex colors matching the reaction',
          },
          burpBubbleCount: {
            type: Type.INTEGER,
            description: 'Number of bubbles to spawn between 22 and 30',
          },
        },
        required: [
          'soupName',
          'reactionType',
          'characterLine',
          'narratorLine',
          'soupColor',
          'effectColors',
          'burpBubbleCount',
        ],
      }
    );

    const validReactions: ReactionType[] = [
      'delicious',
      'spicy',
      'freezing',
      'yucky',
      'balloon',
      'giant',
    ];
    const reactionType = validReactions.includes(result.reactionType)
      ? result.reactionType
      : 'delicious';

    return {
      soupName: result.soupName || 'Super Silly Magic Soup',
      reactionType,
      characterLine:
        result.characterLine ||
        `<laugh> Mmm! This ${result.soupName || 'magic soup'} makes my tummy feel funny! Excuse me... BUUURP!`,
      narratorLine:
        result.narratorLine || 'Pop all the magic burp bubbles with your hands!',
      soupColor: result.soupColor || '#a855f7',
      effectColors:
        result.effectColors?.length >= 2
          ? result.effectColors
          : ['#f472b6', '#38bdf8', '#facc15'],
      burpBubbleCount: Math.min(32, Math.max(20, result.burpBubbleCount || 25)),
    };
  } catch (err) {
    console.error('[evaluateSoupRecipe] Falling back to offline evaluation:', err);
    return createOfflineSoupEvaluation(character, ingredients);
  }
}

const PCM_SAMPLE_RATE = 24000;

/** True when a mime type names headerless PCM (e.g. `audio/L16;codec=pcm;rate=24000`). */
function isRawPcmMimeType(mimeType: string): boolean {
  return /audio\/(l16|pcm)|codec=pcm/i.test(mimeType);
}

/**
 * Reads the sample rate from a raw PCM mime type such as `audio/L16;codec=pcm;rate=24000`,
 * falling back to the 24kHz Gemini TTS default.
 */
function parsePcmSampleRate(mimeType: string | undefined): number {
  const rate = Number(/rate=(\d+)/i.exec(mimeType ?? '')?.[1]);
  return rate > 0 ? rate : PCM_SAMPLE_RATE;
}

/**
 * Wraps headerless 16-bit mono PCM in a 44-byte RIFF/WAVE header so the browser can play it.
 */
function pcm24kToWavBase64(rawPcm: Buffer, sampleRate = PCM_SAMPLE_RATE): string {
  // Drop a trailing half-sample so the data chunk holds whole 16-bit samples
  const pcm = rawPcm.subarray(0, rawPcm.length - (rawPcm.length % 2));
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

/**
 * `gemini-3.8-flash-lite-tts` already returns a complete WAV (starting with `RIFF`), while
 * older TTS models return raw PCM. Only wrap the latter, otherwise the browser plays our
 * header plus theirs and the original `RIFF....WAVEfmt ` bytes come out as an audible click.
 * A payload whose mime type names some other format (e.g. `audio/mpeg`) is passed through untouched;
 * with no mime type (the Interactions API), anything that is not already a WAV is assumed to be
 * 24kHz PCM. Returns null for an empty payload.
 */
function toWavBase64(base64Audio: string, mimeType?: string): string | null {
  const rawBuffer = Buffer.from(base64Audio, 'base64');
  if (rawBuffer.length === 0) return null;
  if (rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF') return base64Audio;
  if (mimeType && !isRawPcmMimeType(mimeType)) return base64Audio;
  return pcm24kToWavBase64(rawBuffer, parsePcmSampleRate(mimeType));
}

/**
 * Synthesizes expressive speech using Gemini 3.8 Flash TTS (`gemini-3.8-flash-lite-tts` / `gemini-3.8-flash-tts`).
 * Returns a base64-encoded WAV buffer (`audio/wav` with standard RIFF header).
 */
export async function generateSpeechWavBase64(
  text: string,
  voiceName = 'Puck',
  style = 'cheerful, warm, animated cartoon voice for a 4-year-old child'
): Promise<string | null> {
  const ai = getClient();
  if (!ai || !text.trim()) return null;

  const modelsToTry = [TTS_MODEL, 'gemini-3.8-flash-tts'];

  for (const model of modelsToTry) {
    try {
      const anyAi = ai as unknown as {
        interactions?: {
          create: (req: Record<string, unknown>) => Promise<{
            output_audio?: { data?: string };
          }>;
        };
      };

      // 1. Official Gemini 3.8 TTS Interactions API with structured speech_metadata (single-speaker)
      if (anyAi.interactions && typeof anyAi.interactions.create === 'function') {
        const interaction = await anyAi.interactions.create({
          model,
          input: [
            {
              type: 'user_input',
              content: [
                {
                  type: 'text',
                  text,
                  annotations: [
                    {
                      type: 'speech_metadata',
                      style,
                    },
                  ],
                },
              ],
            },
          ],
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: [{ voice: voiceName }],
          },
        });

        if (interaction?.output_audio?.data) {
          const wav = toWavBase64(interaction.output_audio.data);
          if (wav) return wav;
        }
      }

      // 2. Fallback to generateContent with Gemini 3.8 TTS speech_metadata
      const ttsPart = {
        text,
        speech_metadata: {
          style,
        },
      };
      const response = await ai.models.generateContent({
        model,
        contents: [ttsPart],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      });

      const audioPart = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.data
      );
      if (audioPart?.inlineData?.data) {
        const wav = toWavBase64(
          audioPart.inlineData.data,
          audioPart.inlineData.mimeType
        );
        if (wav) return wav;
      }
    } catch (err) {
      console.warn(`[Gemini 3.8 TTS] Model ${model} failed:`, err);
    }
  }

  return null;
}

/**
 * Transcribes raw audio recorded from the microphone using `gemini-3.5-transcribe` (or `gemini-3.8-flash`).
 */
export async function transcribeToddlerAudio(
  base64Audio: string,
  mimeType = 'audio/webm'
): Promise<string> {
  const ai = getClient();
  if (!ai || !base64Audio) return '';

  const models = [TRANSCRIBE_MODEL, BRAIN_MODEL];
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: base64Audio,
                  mimeType,
                },
              },
              {
                text: 'Transcribe only the exact words spoken by the child or parent in this audio clip. Return plain text only, with no quotes or extra commentary. If silence or noise, return empty string.',
              },
            ],
          },
        ],
      });
      const parts = response.candidates?.[0]?.content?.parts || [];
      let transcript = '';
      for (const p of parts) {
        const anyPart = p as Record<string, unknown>;
        const audioTrans = anyPart.audioTranscription as
          | { text?: string }
          | undefined;
        if (audioTrans?.text) {
          transcript += ' ' + audioTrans.text;
        } else if (typeof p.text === 'string') {
          transcript += ' ' + p.text;
        }
      }
      transcript = transcript.trim();
      if (transcript) return transcript;
    } catch (err) {
      console.warn(`[Gemini Transcribe] Model ${model} failed:`, err);
    }
  }

  return '';
}

// ============================================================================
// Offline / No-API-Key Procedural Fallbacks (Zero-crash guarantee!)
// ============================================================================

const EMOJI_MAP: Array<{ keywords: string[]; emoji: string; color: string; category: IngredientItem['category'] }> = [
  { keywords: ['dino', 'rex', 'dragon', 'lizard'], emoji: '🦖', color: '#10b981', category: 'magic' },
  { keywords: ['unicorn', 'horse', 'pony', 'princess'], emoji: '🦄', color: '#ec4899', category: 'magic' },
  { keywords: ['cat', 'kitty', 'kitten', 'lion', 'tiger'], emoji: '🐱', color: '#fb923c', category: 'silly' },
  { keywords: ['dog', 'puppy', 'woof'], emoji: '🐶', color: '#f59e0b', category: 'silly' },
  { keywords: ['robot', 'bot', 'machine'], emoji: '🤖', color: '#38bdf8', category: 'crunchy' },
  { keywords: ['monster', 'alien'], emoji: '👾', color: '#8b5cf6', category: 'silly' },
  { keywords: ['shark', 'fish', 'whale', 'octopus'], emoji: '🦈', color: '#0ea5e9', category: 'silly' },
  { keywords: ['bear', 'teddy', 'panda'], emoji: '🐻', color: '#d97706', category: 'sweet' },
  { keywords: ['bunny', 'rabbit'], emoji: '🐰', color: '#f472b6', category: 'sweet' },
  { keywords: ['super', 'hero', 'spider'], emoji: '🦸', color: '#ef4444', category: 'magic' },
  { keywords: ['truck', 'car', 'train', 'bus'], emoji: '🚚', color: '#ef4444', category: 'crunchy' },
  { keywords: ['sock', 'shoe', 'boot', 'pants', 'underwear'], emoji: '🧦', color: '#84cc16', category: 'silly' },
  { keywords: ['ice', 'snow', 'cold', 'freeze', 'popsicle'], emoji: '🍦', color: '#38bdf8', category: 'icy' },
  { keywords: ['fire', 'chili', 'pepper', 'hot', 'spicy', 'lava'], emoji: '🌶️', color: '#f97316', category: 'spicy' },
  { keywords: ['cake', 'cupcake', 'cookie', 'candy', 'chocolate', 'donut'], emoji: '🧁', color: '#f472b6', category: 'sweet' },
  { keywords: ['apple', 'strawberry', 'berry', 'cherry', 'watermelon'], emoji: '🍓', color: '#f43f5e', category: 'fruity' },
  { keywords: ['banana', 'lemon', 'cheese', 'corn'], emoji: '🍌', color: '#eab308', category: 'fruity' },
  { keywords: ['broccoli', 'pea', 'pickle', 'lettuce', 'spinach'], emoji: '🥦', color: '#22c55e', category: 'crunchy' },
  { keywords: ['pizza', 'burger', 'taco', 'noodle', 'spaghetti'], emoji: '🍕', color: '#f59e0b', category: 'crunchy' },
  { keywords: ['frog', 'toad', 'bug', 'worm', 'spider', 'snail'], emoji: '🐸', color: '#10b981', category: 'silly' },
];

function matchKeywordMeta(text: string) {
  const lower = text.toLowerCase();
  for (const entry of EMOJI_MAP) {
    if (entry.keywords.some((k) => lower.includes(k))) {
      return entry;
    }
  }
  return { emoji: '🌟', color: '#a855f7', category: 'magic' as const };
}

function capitalizeWords(str: string): string {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function createOfflineCharacter(speech: string): CharacterItem {
  const meta = matchKeywordMeta(speech);
  const cleanTitle = capitalizeWords(speech.replace(/^(a|an|the)\s+/i, '')).slice(0, 28);
  const char: CharacterItem = {
    id: `char-${Date.now()}`,
    name: cleanTitle || 'Buddy',
    title: 'The Hungry Friend',
    description: speech,
    greeting: `<laugh> Yay! I am ${cleanTitle || 'your new friend'}! Let's cook a super silly soup together!`,
    craving: 'Something colorful and magical!',
    themeColor: meta.color,
    voiceName: 'Puck',
    voiceStyle: 'cheerful cartoon friend',
    voicePitch: 1.1,
    emoji: meta.emoji,
    imageUrl: createStarterCharacterSvg(meta.emoji, meta.color, '#ffffff'),
    createdAt: Date.now(),
  };
  pantryStore.addCharacter(char);
  return char;
}

function createOfflineIngredient(speech: string): IngredientItem {
  const meta = matchKeywordMeta(speech);
  const cleanName = capitalizeWords(speech.replace(/^(a|an|the|some)\s+/i, '')).slice(0, 24);
  const ing: IngredientItem = {
    id: `ing-${Date.now()}`,
    name: cleanName || 'Magic Sparkle',
    category: meta.category,
    splashColor: meta.color,
    characterComment: `<laugh> Whoa! ${cleanName || 'That'} is going right into the pot! Splash!`,
    emoji: meta.emoji,
    imageUrl: createStarterIngredientSvg(meta.emoji, '#fef3c7'),
    createdAt: Date.now(),
  };
  pantryStore.addIngredient(ing);
  return ing;
}

function createOfflineSoupEvaluation(
  character: CharacterItem,
  ingredients: IngredientItem[]
): SoupEvaluation {
  const categories = ingredients.map((i) => i.category);
  let reactionType: ReactionType = 'delicious';
  if (categories.includes('spicy')) reactionType = 'spicy';
  else if (categories.includes('icy')) reactionType = 'freezing';
  else if (categories.includes('silly')) reactionType = 'yucky';
  else if (categories.includes('magic')) reactionType = 'balloon';
  else if (categories.includes('crunchy')) reactionType = 'giant';

  const soupName = `${ingredients.map((i) => i.name.split(' ').pop()).join('-')} Surprise Soup`;

  const reactionLines: Record<ReactionType, string> = {
    delicious: `<laugh> YUMMM! This ${soupName} is the best thing I ever tasted! Let's dance!`,
    spicy: `WHOAAA! <laugh> HOT HOT HOT! That soup gave me dragon fire breath!`,
    freezing: `BRRRR! <laugh> That soup is SO cold it froze my tummy into an ice cube!`,
    yucky: `BLEH-HEH-HEH! <laugh> That soup is super goofy and stinky! I love it!`,
    balloon: `WHOA! <laugh> I'm puffing up like a giant bouncy balloon! Look at me float!`,
    giant: `ROOOAR! <laugh> That crunchy soup made me GIANT! Stomp stomp stomp!`,
  };

  return {
    soupName,
    reactionType,
    characterLine: reactionLines[reactionType],
    narratorLine: 'Look at all those bubbles! Pop them with your hands!',
    soupColor: ingredients[ingredients.length - 1]?.splashColor || character.themeColor,
    effectColors: ingredients.map((i) => i.splashColor),
    burpBubbleCount: 26,
  };
}
