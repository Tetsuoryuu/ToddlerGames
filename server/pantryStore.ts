import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CharacterItem, IngredientItem, PantryData } from '../src/types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PANTRY_JSON_PATH = path.join(DATA_DIR, 'pantry.json');
const PUBLIC_PANTRY_DIR = path.resolve(process.cwd(), 'public', 'pantry');

function svgToDataUrl(svg: string): string {
  const cleaned = svg.trim().replace(/\s+/g, ' ');
  return `data:image/svg+xml;utf8,${encodeURIComponent(cleaned)}`;
}

export function createStarterCharacterSvg(emoji: string, bgColor: string, accentColor: string): string {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
      <defs>
        <filter id="shadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/>
        </filter>
        <radialGradient id="grad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="${accentColor}"/>
          <stop offset="100%" stop-color="${bgColor}"/>
        </radialGradient>
      </defs>
      <g filter="url(#shadow)">
        <circle cx="120" cy="125" r="95" fill="#ffffff"/>
        <circle cx="120" cy="125" r="84" fill="url(#grad)"/>
        <ellipse cx="90" cy="85" rx="28" ry="14" fill="#ffffff" opacity="0.35" transform="rotate(-20 90 85)"/>
        <text x="120" y="152" font-size="105" text-anchor="middle" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">${emoji}</text>
      </g>
    </svg>
  `);
}

export function createStarterIngredientSvg(emoji: string, ringColor: string): string {
  return svgToDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
      <defs>
        <filter id="ishadow" x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.3"/>
        </filter>
      </defs>
      <g filter="url(#ishadow)">
        <circle cx="90" cy="90" r="74" fill="#ffffff"/>
        <circle cx="90" cy="90" r="65" fill="${ringColor}"/>
        <circle cx="70" cy="65" r="16" fill="#ffffff" opacity="0.4"/>
        <text x="90" y="114" font-size="78" text-anchor="middle" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">${emoji}</text>
      </g>
    </svg>
  `);
}

const STARTER_CHARACTERS: CharacterItem[] = [
  {
    id: 'starter-dino-king',
    name: 'King Chompy',
    title: 'The Royal T-Rex',
    description: 'A friendly green dinosaur wearing a shiny gold crown',
    greeting: 'ROAR! <laugh> Hi Little Chef! I am King Chompy, and my tummy is rumbling for royal soup!',
    craving: 'Something crunchy and silly!',
    themeColor: '#34d399',
    voiceName: 'Puck',
    voiceStyle: 'playful, bouncy, excited cartoon dinosaur for a 4-year-old',
    voicePitch: 0.9,
    emoji: '🦖',
    imageUrl: createStarterCharacterSvg('🦖', '#10b981', '#6ee7b7'),
    createdAt: 1700000000001,
    isStarter: true,
  },
  {
    id: 'starter-space-unicorn',
    name: 'Princess Sparkle',
    title: 'The Rainbow Unicorn',
    description: 'A magical pink unicorn with rainbow wings',
    greeting: 'Neigh! <laugh> Hello chef! I flew down from a rainbow cloud to taste your magic potion!',
    craving: 'Something sweet and sparkly!',
    themeColor: '#f472b6',
    voiceName: 'Kore',
    voiceStyle: 'magical, giggly, warm storybook princess unicorn',
    voicePitch: 1.25,
    emoji: '🦄',
    imageUrl: createStarterCharacterSvg('🦄', '#ec4899', '#fbcfe8'),
    createdAt: 1700000000002,
    isStarter: true,
  },
  {
    id: 'starter-robo-chef',
    name: 'Beep-Boop Bob',
    title: 'The Silly Robot',
    description: 'A shiny blue robot who loves eating wacky things',
    greeting: 'BEEP BOOP! <laugh> Greetings Little Chef! My battery needs a super silly soup!',
    craving: 'Somethingfizzy or mechanical!',
    themeColor: '#38bdf8',
    voiceName: 'Charon',
    voiceStyle: 'bouncy, enthusiastic cartoon robot',
    voicePitch: 1.05,
    emoji: '🤖',
    imageUrl: createStarterCharacterSvg('🤖', '#0284c7', '#bae6fd'),
    createdAt: 1700000000003,
    isStarter: true,
  },
  {
    id: 'starter-pirate-cat',
    name: 'Captain Whiskers',
    title: 'The Pirate Kitty',
    description: 'An orange tabby cat wearing a pirate hat',
    greeting: 'Meow-hoy, matey! <laugh> I sailed the seven seas for a bowl of your magic soup!',
    craving: 'Something fishy or adventurous!',
    themeColor: '#fb923c',
    voiceName: 'Fenrir',
    voiceStyle: 'goofy, cheerful cartoon pirate cat',
    voicePitch: 1.1,
    emoji: '🐱',
    imageUrl: createStarterCharacterSvg('🐱', '#ea580c', '#fed7aa'),
    createdAt: 1700000000004,
    isStarter: true,
  },
];

const STARTER_INGREDIENTS: IngredientItem[] = [
  {
    id: 'ing-cupcake',
    name: 'Rainbow Cupcake',
    category: 'sweet',
    splashColor: '#f472b6',
    characterComment: 'Ooh! A sparkly cupcake! Yum yum!',
    emoji: '🧁',
    imageUrl: createStarterIngredientSvg('🧁', '#fce7f3'),
    createdAt: 1700000000010,
    isStarter: true,
  },
  {
    id: 'ing-monster-truck',
    name: 'Monster Truck',
    category: 'silly',
    splashColor: '#ef4444',
    characterComment: 'WHAT?! A whole monster truck in my soup?! Vroom vroom!',
    emoji: '🚚',
    imageUrl: createStarterIngredientSvg('🚚', '#fee2e2'),
    createdAt: 1700000000011,
    isStarter: true,
  },
  {
    id: 'ing-smelly-sock',
    name: 'Smelly Sock',
    category: 'silly',
    splashColor: '#84cc16',
    characterComment: 'Pee-yew! <laugh> A stinky sock?! That is SO silly!',
    emoji: '🧦',
    imageUrl: createStarterIngredientSvg('🧦', '#ecfccb'),
    createdAt: 1700000000012,
    isStarter: true,
  },
  {
    id: 'ing-broccoli',
    name: 'Giggling Broccoli',
    category: 'crunchy',
    splashColor: '#22c55e',
    characterComment: 'Crunchy green broccoli! Super power food!',
    emoji: '🥦',
    imageUrl: createStarterIngredientSvg('🥦', '#dcfce7'),
    createdAt: 1700000000013,
    isStarter: true,
  },
  {
    id: 'ing-fire-pepper',
    name: 'Dragon Chili Pepper',
    category: 'spicy',
    splashColor: '#f97316',
    characterComment: 'Uh oh! That chili pepper looks SUPER spicy!',
    emoji: '🌶️',
    imageUrl: createStarterIngredientSvg('🌶️', '#ffedd5'),
    createdAt: 1700000000014,
    isStarter: true,
  },
  {
    id: 'ing-ice-cream',
    name: 'Freezing Ice Cream',
    category: 'icy',
    splashColor: '#38bdf8',
    characterComment: 'Brrr! Cold, creamy ice cream in the hot pot!',
    emoji: '🍦',
    imageUrl: createStarterIngredientSvg('🍦', '#e0f2fe'),
    createdAt: 1700000000015,
    isStarter: true,
  },
  {
    id: 'ing-banana',
    name: 'Golden Banana',
    category: 'fruity',
    splashColor: '#eab308',
    characterComment: 'Ooh, a squishy yellow banana!',
    emoji: '🍌',
    imageUrl: createStarterIngredientSvg('🍌', '#fef9c3'),
    createdAt: 1700000000016,
    isStarter: true,
  },
  {
    id: 'ing-frog',
    name: 'Bouncy Frog',
    category: 'magic',
    splashColor: '#10b981',
    characterComment: 'Ribbit! <laugh> That frog just jumped into the soup!',
    emoji: '🐸',
    imageUrl: createStarterIngredientSvg('🐸', '#d1fae5'),
    createdAt: 1700000000017,
    isStarter: true,
  },
];

export class PantryStore {
  private data: PantryData = {
    characters: [],
    ingredients: [],
  };

  constructor() {
    this.ensureDirs();
    this.load();
  }

  private ensureDirs(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(PUBLIC_PANTRY_DIR)) {
      fs.mkdirSync(PUBLIC_PANTRY_DIR, { recursive: true });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(PANTRY_JSON_PATH)) {
        const raw = fs.readFileSync(PANTRY_JSON_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as PantryData;
        this.data = {
          characters: parsed.characters?.length ? parsed.characters : [...STARTER_CHARACTERS],
          ingredients: parsed.ingredients?.length ? parsed.ingredients : [...STARTER_INGREDIENTS],
        };
      } else {
        this.data = {
          characters: [...STARTER_CHARACTERS],
          ingredients: [...STARTER_INGREDIENTS],
        };
        this.save();
      }
    } catch (err) {
      console.error('Failed to load pantry.json, using starters:', err);
      this.data = {
        characters: [...STARTER_CHARACTERS],
        ingredients: [...STARTER_INGREDIENTS],
      };
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(PANTRY_JSON_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save pantry.json:', err);
    }
  }

  public getPantry(): PantryData {
    return this.data;
  }

  public findCachedCharacter(query: string): CharacterItem | undefined {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return undefined;
    return this.data.characters.find(
      (c) =>
        c.name.toLowerCase() === normalized ||
        c.description.toLowerCase() === normalized
    );
  }

  public findCachedIngredient(query: string): IngredientItem | undefined {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return undefined;
    return this.data.ingredients.find(
      (i) => i.name.toLowerCase() === normalized
    );
  }

  public saveImageBuffer(prefix: string, base64Data: string): string {
    const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
    const filePath = path.join(PUBLIC_PANTRY_DIR, filename);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return `/pantry/${filename}`;
  }

  public addCharacter(character: CharacterItem): void {
    // Keep newest custom characters at the front, max 30
    this.data.characters = [
      character,
      ...this.data.characters.filter((c) => c.id !== character.id),
    ].slice(0, 30);
    this.save();
  }

  public addIngredient(ingredient: IngredientItem): void {
    this.data.ingredients = [
      ingredient,
      ...this.data.ingredients.filter((i) => i.id !== ingredient.id),
    ].slice(0, 40);
    this.save();
  }
}

export const pantryStore = new PantryStore();
