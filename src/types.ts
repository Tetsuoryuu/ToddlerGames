export type ReactionType =
  | 'delicious'
  | 'spicy'
  | 'freezing'
  | 'yucky'
  | 'balloon'
  | 'giant';

export interface CharacterItem {
  id: string;
  name: string;
  title: string;
  description: string;
  greeting: string;
  craving: string;
  themeColor: string;
  voiceName: string; // e.g., 'Puck', 'Kore', 'Fenrir', 'Aoede', 'Charon'
  voiceStyle: string; // e.g., 'cheerful and bouncy cartoon dinosaur'
  voicePitch: number; // 0.7 to 1.4 for browser fallback
  emoji: string;
  imageUrl: string; // URL to saved PNG or SVG data URL
  createdAt: number;
  isStarter?: boolean;
}

export interface IngredientItem {
  id: string;
  name: string;
  category: 'sweet' | 'spicy' | 'icy' | 'silly' | 'crunchy' | 'fruity' | 'magic';
  splashColor: string;
  characterComment: string;
  emoji: string;
  imageUrl: string;
  createdAt: number;
  isStarter?: boolean;
}

export interface SoupEvaluation {
  soupName: string;
  reactionType: ReactionType;
  characterLine: string;
  narratorLine: string;
  soupColor: string;
  effectColors: string[];
  burpBubbleCount: number;
}

export interface PantryData {
  characters: CharacterItem[];
  ingredients: IngredientItem[];
}

export type GameMode = 'CAULDRON' | 'FLYING_TRAIN';

export type GamePhase =
  | 'WELCOME'
  | 'ASK_PLAYER_NAME'
  | 'SUMMON_PROMPT'
  | 'MAGIC_CLOUD_RITUAL'
  | 'GUEST_GREETING'
  | 'ADDING_INGREDIENTS'
  | 'STIRRING_POT'
  | 'FEEDING_SPOON'
  | 'TASTE_REACTION'
  | 'BUBBLE_FINALE'
  | 'TRAIN_PICK_AMMO'
  | 'TRAIN_BLASTING_SKY'
  | 'TRAIN_BUBBLE_PARTY';

export interface HandPoint {
  x: number; // Normalized 0..1 (mirrored so 0 is left of screen, 1 is right)
  y: number; // Normalized 0..1
  vx: number; // Velocity X (normalized per second)
  vy: number; // Velocity Y (normalized per second)
  radius: number; // Normalized hand size
  isMouse?: boolean;
}

export interface FloatingIngredient {
  uid: string;
  item: IngredientItem;
  x: number; // Canvas pixel X
  y: number; // Canvas pixel Y
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  vRot: number;
  scaleX: number;
  scaleY: number;
  squashVel: number;
  hitCooldown: number;
  isMysteryBubble: boolean; // True while sticker image is still generating
  spawnTime: number;
  imageElement?: HTMLImageElement;
}

export interface BurpBubble {
  uid: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  emoji: string;
  imageElement?: HTMLImageElement;
  wobblePhase: number;
  scaleX?: number;
  scaleY?: number;
}

export interface TrainProjectile {
  uid: string;
  item: IngredientItem;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  vRot: number;
  imageElement?: HTMLImageElement;
}

export interface SkyTarget {
  uid: string;
  x: number;
  y: number;
  baseY: number;
  vx: number;
  vy: number;
  radius: number;
  wobblePhase: number;
  scaleX: number;
  scaleY: number;
  squashVel: number;
  state: 'grumpy' | 'happy' | 'boss_pinata';
  hp: number;
  maxHp: number;
  hitCooldown: number;
  rainbowColor: string;
  hitAmmoEmoji: string;
  hitAmmoImage?: HTMLImageElement;
  happyLeaveTimer: number;
  label: string;
}

export interface TrainSteamPuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
}
