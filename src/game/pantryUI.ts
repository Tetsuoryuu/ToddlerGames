import type { CharacterItem, IngredientItem, PantryData } from '../types.ts';
import { loadStickerImage } from './stickerUtils.ts';

export class PantryUI {
  private charShelfEl: HTMLElement;
  private ingShelfEl: HTMLElement;
  private onSelectCharacter: (char: CharacterItem) => void;
  private onSelectIngredient: (ing: IngredientItem) => void;

  constructor(
    charShelfEl: HTMLElement,
    ingShelfEl: HTMLElement,
    onSelectCharacter: (char: CharacterItem) => void,
    onSelectIngredient: (ing: IngredientItem) => void
  ) {
    this.charShelfEl = charShelfEl;
    this.ingShelfEl = ingShelfEl;
    this.onSelectCharacter = onSelectCharacter;
    this.onSelectIngredient = onSelectIngredient;
  }

  public renderPantry(pantry: PantryData): void {
    // 1. Render Saved Characters Shelf (Large visual-only sticker medallions)
    this.charShelfEl.innerHTML = '';
    for (const char of pantry.characters) {
      const btn = document.createElement('button');
      btn.className = 'sticker-card character-card';
      btn.title = `${char.emoji} ${char.name}`;
      btn.style.setProperty('--card-accent', char.themeColor);

      const img = document.createElement('img');
      img.alt = char.name;
      if (char.imageUrl.startsWith('data:image/svg+xml')) {
        img.src = char.imageUrl;
      }
      void loadStickerImage(char.imageUrl).then((processed) => {
        img.src = processed.src;
      });

      btn.appendChild(img);
      btn.addEventListener('click', () => this.onSelectCharacter(char));
      this.charShelfEl.appendChild(btn);
    }

    // 2. Render Saved Ingredients Shelf (Large visual-only sticker medallions)
    this.ingShelfEl.innerHTML = '';
    for (const ing of pantry.ingredients) {
      const btn = document.createElement('button');
      btn.className = 'sticker-card ingredient-card';
      btn.title = `${ing.emoji} ${ing.name}`;
      btn.style.setProperty('--card-accent', ing.splashColor);

      const img = document.createElement('img');
      img.alt = ing.name;
      if (ing.imageUrl.startsWith('data:image/svg+xml')) {
        img.src = ing.imageUrl;
      }
      void loadStickerImage(ing.imageUrl).then((processed) => {
        img.src = processed.src;
      });

      btn.appendChild(img);
      btn.addEventListener('click', () => this.onSelectIngredient(ing));
      this.ingShelfEl.appendChild(btn);
    }
  }
}
