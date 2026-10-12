import type {
  CharacterItem,
  GameMode,
  GamePhase,
  HandPoint,
  IngredientItem,
  ReactionType,
  SkyTarget,
} from '../types.ts';
import type { GamePhysics } from './physics.ts';
import { getCachedSticker } from './stickerUtils.ts';

export interface RenderState {
  gameMode?: GameMode;
  phase: GamePhase;
  character: CharacterItem | null;
  potIngredients: IngredientItem[];
  activeTrainAmmo?: IngredientItem | null;
  soupColor: string;
  magicCloudProgress: number; // 0..1
  stirProgress: number; // 0..1
  activeReaction: ReactionType | null;
  reactionStartTime: number;
  hands: HandPoint[];
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D context');
    this.ctx = context;
  }

  public getLayout(w: number, h: number) {
    return {
      cauldronX: w * 0.58,
      cauldronRimY: h * 0.72,
      cauldronRadiusX: Math.min(w * 0.195, 220),
      cauldronRadiusY: Math.min(h * 0.165, 150),
      charX: w * 0.17,
      charY: h * 0.54,
      cloudX: w * 0.5,
      cloudY: h * 0.37,
      cloudRadius: Math.min(w, h) * 0.17,
    };
  }

  public render(
    video: HTMLVideoElement,
    webcamReady: boolean,
    state: RenderState,
    physics: GamePhysics
  ): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    const now = performance.now() / 1000;
    const layout = this.getLayout(w, h);

    ctx.save();

    // Screen shake during Giant Stomp reaction or high stir
    if (state.activeReaction === 'giant') {
      const stompShake = Math.sin(now * 18) * 9;
      ctx.translate(0, Math.abs(stompShake));
    } else if (state.phase === 'STIRRING_POT' && state.stirProgress > 0.65) {
      const shake = (state.stirProgress - 0.65) * 12;
      ctx.translate(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake
      );
    }

    // 1. Draw Mirrored Webcam Feed (or Magical Backdrop)
    if (webcamReady && video.videoWidth > 0) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);

      const videoAspect = video.videoWidth / video.videoHeight;
      const canvasAspect = w / h;
      let drawW = w;
      let drawH = h;
      let offsetX = 0;
      let offsetY = 0;

      if (canvasAspect > videoAspect) {
        drawH = w / videoAspect;
        offsetY = (h - drawH) / 2;
      } else {
        drawW = h * videoAspect;
        offsetX = (w - drawW) / 2;
      }

      ctx.drawImage(video, offsetX, offsetY, drawW, drawH);
      ctx.restore();

      // Warm storybook magical vignette
      const vignette = ctx.createRadialGradient(
        w * 0.5,
        h * 0.45,
        Math.min(w, h) * 0.3,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.75
      );
      if (state.gameMode === 'FLYING_TRAIN') {
        vignette.addColorStop(0, 'rgba(15, 23, 42, 0)');
        vignette.addColorStop(0.75, 'rgba(14, 116, 144, 0.16)');
        vignette.addColorStop(1, 'rgba(30, 58, 138, 0.44)');
      } else {
        vignette.addColorStop(0, 'rgba(15, 23, 42, 0)');
        vignette.addColorStop(0.7, 'rgba(30, 15, 60, 0.18)');
        vignette.addColorStop(1, 'rgba(24, 10, 48, 0.52)');
      }
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    } else {
      // Magical starry background fallback
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      if (state.gameMode === 'FLYING_TRAIN') {
        bg.addColorStop(0, '#0284c7');
        bg.addColorStop(0.55, '#38bdf8');
        bg.addColorStop(1, '#818cf8');
      } else {
        bg.addColorStop(0, '#1e1b4b');
        bg.addColorStop(0.55, '#311042');
        bg.addColorStop(1, '#4c1d95');
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }

    // Branch if we are in Game Mode #2: "Sky Choo-Choo: The Flying Train That Shoots!"
    if (state.gameMode === 'FLYING_TRAIN') {
      this.renderFlyingTrainMode(ctx, w, h, state, physics, now);
      for (const b of physics.burpBubbles) {
        this.drawBurpBubble(ctx, b, now);
      }
      this.drawShockwaves(ctx, physics);
      this.drawParticles(ctx, physics);
      this.drawHands(ctx, state.hands, physics.handTrails, w, h, now);
      ctx.restore();
      return;
    }

    // 1b. Draw Ambient Magical Fireflies & Cozy Kitchen Stage Ledge
    this.drawKitchenStage(
      ctx,
      w,
      h,
      layout.cauldronX,
      layout.cauldronRimY,
      layout.cauldronRadiusX,
      layout.cauldronRadiusY,
      state.soupColor,
      now
    );

    // 2. Draw Rainbow Disco Spotlight Overlay if reaction === 'delicious'
    if (state.activeReaction === 'delicious') {
      ctx.save();
      const hue = (now * 140) % 360;
      ctx.fillStyle = `hsla(${hue}, 90%, 60%, 0.16)`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 3. Draw Hungry Guest Character (with 6 Slapstick Reaction Animations!)
    if (state.character) {
      this.drawCharacter(
        ctx,
        state.character,
        layout.charX,
        layout.charY,
        now,
        state.activeReaction,
        state.phase
      );
    }

    // 4. Draw The 3D Bubbling Magic Cauldron with Sloshing Wave Physics
    this.drawCauldron(
      ctx,
      layout.cauldronX,
      layout.cauldronRimY,
      layout.cauldronRadiusX,
      layout.cauldronRadiusY,
      state.soupColor,
      state.potIngredients,
      state.phase === 'STIRRING_POT',
      state.stirProgress,
      physics.soupWaveHeights,
      now
    );

    // 5. Draw Magic Cloud Ritual (during MAGIC_CLOUD_RITUAL)
    if (state.phase === 'MAGIC_CLOUD_RITUAL') {
      this.drawMagicCloud(
        ctx,
        layout.cloudX,
        layout.cloudY,
        layout.cloudRadius,
        state.magicCloudProgress,
        now
      );
    }

    // 6. Draw Floating Ingredients (with Squash & Stretch + Glossy 3D Soap Bubbles)
    for (const flt of physics.floatingIngredients) {
      this.drawFloatingIngredient(
        ctx,
        flt,
        layout.cauldronX,
        layout.cauldronRimY,
        now
      );
    }

    // 7. Draw Feeding Spoon (during FEEDING_SPOON)
    if (physics.spoonPos.active) {
      this.drawFeedingSpoon(
        ctx,
        physics.spoonPos.x,
        physics.spoonPos.y,
        physics.spoonPos.angle,
        physics.spoonPos.scale,
        state.soupColor,
        layout.charX,
        layout.charY,
        now
      );
    }

    // 8. Draw Burp Bubbles (during BUBBLE_FINALE)
    for (const b of physics.burpBubbles) {
      this.drawBurpBubble(ctx, b, now);
    }

    // 9. Draw Expanding Shockwave Rings & Particles
    this.drawShockwaves(ctx, physics);
    this.drawParticles(ctx, physics);

    // 10. Draw Silky Magic Hand Ribbon Trails & Wands on the Toddler's Hands!
    this.drawHands(ctx, state.hands, physics.handTrails, w, h, now);

    ctx.restore();
  }

  private drawKitchenStage(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    cauldronX: number,
    rimY: number,
    rx: number,
    ry: number,
    soupColor: string,
    now: number
  ): void {
    ctx.save();

    // Ambient floating fireflies
    for (let i = 0; i < 12; i++) {
      const fx =
        ((i * 197 + Math.sin(now * 0.7 + i) * 90) % w + w) % w;
      const fy =
        ((i * 131 + Math.cos(now * 0.9 + i * 1.4) * 60) % (h * 0.75) +
          h * 0.1);
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(now * 2.4 + i));
      const r = 3 + (i % 3) * 1.5;

      const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 4.5);
      glow.addColorStop(0, `rgba(254, 240, 138, ${0.85 * pulse})`);
      glow.addColorStop(0.5, `rgba(250, 204, 21, ${0.3 * pulse})`);
      glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(fx, fy, r * 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle wooden kitchen table ledge at the very bottom
    const tableY = rimY + ry * 1.22;
    if (tableY < h) {
      const woodGrad = ctx.createLinearGradient(0, tableY, 0, h);
      woodGrad.addColorStop(0, 'rgba(69, 26, 3, 0.62)');
      woodGrad.addColorStop(0.15, 'rgba(41, 15, 2, 0.78)');
      woodGrad.addColorStop(1, 'rgba(15, 5, 1, 0.88)');
      ctx.fillStyle = woodGrad;
      ctx.fillRect(0, tableY, w, h - tableY);

      ctx.strokeStyle = 'rgba(217, 119, 6, 0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, tableY);
      ctx.lineTo(w, tableY);
      ctx.stroke();
    }

    // Magical Hearth Glow & Dancing Flames under the Cauldron
    const baseY = rimY + ry * 1.38;
    const fireGlow = ctx.createRadialGradient(
      cauldronX,
      baseY,
      rx * 0.15,
      cauldronX,
      baseY,
      rx * 1.35
    );
    fireGlow.addColorStop(0, 'rgba(251, 146, 60, 0.75)');
    fireGlow.addColorStop(0.45, soupColor + '55');
    fireGlow.addColorStop(1, 'rgba(251, 146, 60, 0)');
    ctx.fillStyle = fireGlow;
    ctx.beginPath();
    ctx.ellipse(cauldronX, baseY, rx * 1.35, ry * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Animated cartoon flames licking the bottom of the cauldron
    const flameColors = ['#f97316', '#facc15', '#ec4899', '#a855f7', '#f97316'];
    for (let i = -3; i <= 3; i++) {
      const fx = cauldronX + i * (rx * 0.24);
      const fh =
        28 +
        Math.sin(now * 11 + i * 1.9) * 12 +
        Math.cos(now * 7 - i) * 8;
      const fw = rx * 0.22;
      ctx.fillStyle = flameColors[Math.abs(i) % flameColors.length];
      ctx.beginPath();
      ctx.moveTo(fx - fw, baseY + 6);
      ctx.quadraticCurveTo(
        fx - fw * 0.3,
        baseY - fh * 0.6,
        fx + Math.sin(now * 9 + i) * 8,
        baseY - fh
      );
      ctx.quadraticCurveTo(fx + fw * 0.3, baseY - fh * 0.6, fx + fw, baseY + 6);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private drawCharacter(
    ctx: CanvasRenderingContext2D,
    character: CharacterItem,
    baseX: number,
    baseY: number,
    now: number,
    reaction: ReactionType | null,
    phase: GamePhase
  ): void {
    ctx.save();

    // Base multiplier makes the character ~3.5x bigger on screen!
    const baseMultiplier = 3.5;

    let x = baseX;
    let y = baseY + Math.sin(now * 3.2) * 14;
    let scaleX = 1 + Math.sin(now * 3.2) * 0.032;
    let scaleY = 1 - Math.sin(now * 3.2) * 0.032;
    let rotation = Math.sin(now * 1.8) * 0.04;

    // Apply transformation animations!
    if (reaction === 'balloon') {
      y = baseY - 120 + Math.sin(now * 2.5) * 32;
      scaleX = 1.25 + Math.sin(now * 5) * 0.06;
      scaleY = 1.25 + Math.cos(now * 5) * 0.06;
      rotation = Math.sin(now * 2) * 0.14;

      // Draw curly balloon string
      ctx.beginPath();
      ctx.moveTo(x, y + 260);
      ctx.quadraticCurveTo(
        x + Math.sin(now * 4) * 45,
        y + 360,
        x,
        baseY + 320
      );
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      ctx.stroke();
    } else if (reaction === 'giant') {
      const stomp = Math.abs(Math.sin(now * 7)) * 45;
      y = baseY - 40 - stomp;
      scaleX = 1.45;
      scaleY = 1.45;
    } else if (reaction === 'delicious') {
      y = baseY - Math.abs(Math.sin(now * 8)) * 45;
      rotation = Math.sin(now * 8) * 0.15;
      scaleX = 1.12 + Math.sin(now * 16) * 0.05;
      scaleY = 1.12 - Math.sin(now * 16) * 0.05;
    } else if (reaction === 'spicy') {
      x += (Math.random() - 0.5) * 18;
      y = baseY - Math.abs(Math.sin(now * 12)) * 36;
    } else if (reaction === 'freezing') {
      x += Math.sin(now * 45) * 10;
    } else if (reaction === 'yucky') {
      scaleX = 1 + Math.sin(now * 9) * 0.18;
      scaleY = 1 - Math.sin(now * 9) * 0.18;
      rotation = Math.sin(now * 5) * 0.2;
    }

    // Grounded dynamic shadow on the floor (scales inversely with jump height)
    const heightOffset = Math.max(0, baseY - y);
    const shadowScale = Math.max(0.45, 1 - heightOffset / 350);
    ctx.save();
    ctx.translate(baseX, baseY + 315);
    ctx.scale(shadowScale, shadowScale);
    const pedGrad = ctx.createRadialGradient(0, 0, 15, 0, 0, 260);
    pedGrad.addColorStop(0, 'rgba(0, 0, 0, 0.48)');
    pedGrad.addColorStop(0.6, character.themeColor + '55');
    pedGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = pedGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 260, 58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(scaleX * baseMultiplier, scaleY * baseMultiplier);

    // Glowing magical aura behind character
    const auraGrad = ctx.createRadialGradient(0, 0, 20, 0, 0, 135);
    auraGrad.addColorStop(0, character.themeColor + 'bb');
    auraGrad.addColorStop(0.6, character.themeColor + '44');
    auraGrad.addColorStop(1, character.themeColor + '00');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 135, 0, Math.PI * 2);
    ctx.fill();

    // Draw character sticker image with soft drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    const img = getCachedSticker(character.imageUrl);
    const size = 220;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else {
      ctx.font = '110px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(character.emoji || '🦖', 0, 0);
    }
    ctx.restore();

    // Draw special reaction overlays on the character
    if (reaction === 'freezing') {
      // Glossy 3D Translucent Ice Cube around character!
      const iceGrad = ctx.createLinearGradient(-115, -115, 115, 115);
      iceGrad.addColorStop(0, 'rgba(224, 242, 254, 0.65)');
      iceGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.42)');
      iceGrad.addColorStop(1, 'rgba(125, 211, 252, 0.68)');
      ctx.fillStyle = iceGrad;
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(-115, -115, 230, 230, 24);
      ctx.fill();
      ctx.stroke();

      // Diagonal specular ice glint
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-88, -60);
      ctx.lineTo(-60, -88);
      ctx.moveTo(-85, -30);
      ctx.lineTo(-30, -85);
      ctx.stroke();
    } else if (reaction === 'spicy') {
      ctx.font = '56px sans-serif';
      ctx.textAlign = 'center';
      const flameOffset = (now * 160) % 70;
      ctx.fillText('🔥', 85 + flameOffset, -15);
      ctx.fillText('🔥', 115 + flameOffset * 0.7, -35);
      ctx.fillText('💨', -95, -75 - (flameOffset % 30));
      ctx.fillText('💨', 95, -75 - (flameOffset % 30));
    } else if (reaction === 'yucky') {
      ctx.font = '46px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🤢', 0, -120);
      ctx.fillText('💭', -90, -80 + Math.sin(now * 6) * 12);
      ctx.fillText('💫', 90, -80 + Math.cos(now * 6) * 12);
    } else if (reaction === 'delicious') {
      ctx.font = '44px sans-serif';
      for (let i = 0; i < 4; i++) {
        const ang = now * 3.5 + (i * Math.PI) / 2;
        ctx.fillText('🌈', Math.cos(ang) * 120, Math.sin(ang) * 90 - 20);
      }
    }

    // Open mouth target indicator when feeding spoon!
    if (phase === 'FEEDING_SPOON') {
      const pulse = 1 + Math.sin(now * 7) * 0.16;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 4;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.arc(0, -10, 40 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Polished 3D Name Ribbon below character
    ctx.save();
    const badgeY = Math.min(this.canvas.height - 88, baseY + 340);
    ctx.translate(baseX, badgeY);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;

    const pillGrad = ctx.createLinearGradient(0, -28, 0, 28);
    pillGrad.addColorStop(0, 'rgba(30, 41, 59, 0.94)');
    pillGrad.addColorStop(1, 'rgba(15, 23, 42, 0.96)');
    ctx.fillStyle = pillGrad;
    ctx.strokeStyle = character.themeColor;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.roundRect(-155, -28, 310, 56, 28);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 25px "Comic Sans MS", "Chalkboard SE", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${character.emoji} ${character.name}`, 0, 1);
    ctx.restore();
  }

  private drawCauldron(
    ctx: CanvasRenderingContext2D,
    cx: number,
    rimY: number,
    rx: number,
    ry: number,
    soupColor: string,
    potIngredients: IngredientItem[],
    isStirring: boolean,
    stirProgress: number,
    waveHeights: number[],
    now: number
  ): void {
    ctx.save();

    // 1. Cast-Iron Side Handles (Ears)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    // Left handle
    ctx.beginPath();
    ctx.arc(cx - rx * 0.98, rimY + ry * 0.42, rx * 0.22, 0.5, Math.PI * 1.45);
    ctx.stroke();
    // Right handle
    ctx.beginPath();
    ctx.arc(
      cx + rx * 0.98,
      rimY + ry * 0.42,
      rx * 0.22,
      -Math.PI * 0.45,
      Math.PI - 0.5
    );
    ctx.stroke();

    // Metallic highlight on handles
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx - rx * 0.98, rimY + ry * 0.42, rx * 0.22, 0.8, Math.PI * 1.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(
      cx + rx * 0.98,
      rimY + ry * 0.42,
      rx * 0.22,
      -Math.PI * 0.25,
      Math.PI - 0.8
    );
    ctx.stroke();

    // 2. Cauldron Rim (Back Interior Lip)
    const backRimGrad = ctx.createLinearGradient(cx, rimY - ry * 0.28, cx, rimY + ry * 0.2);
    backRimGrad.addColorStop(0, '#475569');
    backRimGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = backRimGrad;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(cx, rimY, rx * 1.0, ry * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3. Giant Wooden Stirring Spoon dipped INSIDE the pot during STIRRING_POT
    if (isStirring) {
      ctx.save();
      const spoonAngle = Math.sin(now * (4.5 + stirProgress * 10)) * 0.44;
      const spoonHoriz = Math.cos(now * (4.5 + stirProgress * 10)) * (rx * 0.22);
      ctx.translate(cx + spoonHoriz, rimY + 12);
      ctx.rotate(spoonAngle);

      // Shadow on handle
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 14;

      const woodGrad = ctx.createLinearGradient(-32, -310, 32, 0);
      woodGrad.addColorStop(0, '#f59e0b');
      woodGrad.addColorStop(0.5, '#d97706');
      woodGrad.addColorStop(1, '#78350f');
      ctx.fillStyle = woodGrad;
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(-28, -305, 56, 315, 28);
      ctx.fill();
      ctx.stroke();

      // Big rounded knob at top of stirring spoon
      ctx.beginPath();
      ctx.arc(0, -305, 38, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Wood grain highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-10, -280);
      ctx.lineTo(-10, -40);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Dynamic Wave-Simulated Bubbling Soup Surface (Clipped to Cauldron Mouth)
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, rimY + 4, rx * 0.92, ry * 0.23, 0, 0, Math.PI * 2);
    ctx.clip();

    // Base soup glow
    const soupGrad = ctx.createRadialGradient(
      cx,
      rimY,
      rx * 0.1,
      cx,
      rimY,
      rx * 0.95
    );
    soupGrad.addColorStop(0, '#ffffff');
    soupGrad.addColorStop(0.22, soupColor);
    soupGrad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = soupGrad;
    ctx.fillRect(cx - rx, rimY - ry * 0.3, rx * 2, ry * 0.6);

    // Draw coupled-spring liquid wave crest across the soup
    if (waveHeights.length > 1) {
      ctx.fillStyle = soupColor;
      ctx.beginPath();
      const startX = cx - rx * 0.94;
      const width = rx * 1.88;
      ctx.moveTo(startX, rimY + ry * 0.3);
      for (let i = 0; i < waveHeights.length; i++) {
        const wx = startX + (i / (waveHeights.length - 1)) * width;
        const wy =
          rimY -
          4 +
          Math.max(-22, Math.min(22, waveHeights[i] * 0.18)) +
          Math.sin(now * 5 + i * 0.6) * 3;
        ctx.lineTo(wx, wy);
      }
      ctx.lineTo(startX + width, rimY + ry * 0.3);
      ctx.closePath();
      ctx.fill();

      // Glowing wave crest highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < waveHeights.length; i++) {
        const wx = startX + (i / (waveHeights.length - 1)) * width;
        const wy =
          rimY -
          4 +
          Math.max(-22, Math.min(22, waveHeights[i] * 0.18)) +
          Math.sin(now * 5 + i * 0.6) * 3;
        if (i === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
    }

    // Bobbing mini-ingredients swimming inside the soup!
    for (let i = 0; i < potIngredients.length; i++) {
      const ing = potIngredients[i];
      const angle = now * (isStirring ? 4.5 : 1.4) + i * 2.1;
      const ix = cx + Math.cos(angle) * (rx * 0.42);
      const iy = rimY + 4 + Math.sin(angle * 1.5) * (ry * 0.08);
      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(Math.sin(now * 3 + i) * 0.25);
      const sticker = getCachedSticker(ing.imageUrl);
      if (sticker && sticker.complete && sticker.naturalWidth > 0) {
        ctx.drawImage(sticker, -20, -20, 40, 40);
      } else {
        ctx.font = '26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ing.emoji || '✨', 0, 0);
      }
      ctx.restore();
    }

    // Simmering soup surface bubbles
    for (let i = 0; i < 8; i++) {
      const bx = cx + Math.sin(now * 2.1 + i * 1.7) * (rx * 0.68);
      const by = rimY + 2 + Math.cos(now * 2.7 + i * 2.3) * (ry * 0.11);
      const br = 6 + Math.sin(now * 4.5 + i) * 4.5;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(3, br), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 5. Cauldron 3D Dark Cast-Iron Belly (Drawn over the bottom half of the soup)
    const bodyGrad = ctx.createRadialGradient(
      cx - rx * 0.32,
      rimY + ry * 0.38,
      rx * 0.08,
      cx,
      rimY + ry * 0.58,
      rx * 1.18
    );
    bodyGrad.addColorStop(0, '#64748b');
    bodyGrad.addColorStop(0.35, '#334155');
    bodyGrad.addColorStop(0.75, '#1e293b');
    bodyGrad.addColorStop(1, '#090d16');

    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      rimY + ry * 0.56,
      rx * 1.06,
      ry * 0.94,
      0,
      0,
      Math.PI
    );
    ctx.arc(
      cx,
      rimY + ry * 0.56,
      rx * 1.06,
      Math.PI,
      Math.PI * 2,
      false
    );
    ctx.fill();
    ctx.stroke();

    // Re-draw soup surface & front lip over top of belly so the opening is crisp
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, rimY + 3, rx * 0.91, ry * 0.21, 0, 0, Math.PI * 2);
    ctx.fillStyle = soupColor;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();

    // Front Cauldron Rim Lip (Metallic 3D collar)
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(cx, rimY, rx * 0.99, ry * 0.25, 0, 0.08, Math.PI - 0.08);
    ctx.stroke();

    // Specular Rim Shine
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, rimY, rx * 0.99, ry * 0.25, 0, 0.35, Math.PI * 0.45);
    ctx.stroke();

    // Warm firelight reflection on the bottom curve of the cauldron
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.65)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      rimY + ry * 0.56,
      rx * 1.01,
      ry * 0.89,
      0,
      0.25,
      Math.PI - 0.25
    );
    ctx.stroke();

    // 6. Ingredient Counter Gem Badges on Front of Cauldron (1, 2, 3)
    const slotSpacing = rx * 0.54;
    for (let i = 0; i < 3; i++) {
      const sx = cx + (i - 1) * slotSpacing;
      const sy = rimY + ry * 0.66;
      const ing = potIngredients[i];

      ctx.save();
      ctx.shadowColor = ing ? ing.splashColor : 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = ing ? 14 : 6;

      ctx.fillStyle = ing ? ing.splashColor : 'rgba(15, 23, 42, 0.78)';
      ctx.strokeStyle = ing ? '#ffffff' : '#64748b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (ing) {
        const sticker = getCachedSticker(ing.imageUrl);
        if (sticker && sticker.complete && sticker.naturalWidth > 0) {
          ctx.drawImage(sticker, sx - 26, sy - 26, 52, 52);
        } else {
          ctx.font = '32px sans-serif';
          ctx.fillText(ing.emoji || '✨', sx, sy + 2);
        }
      } else {
        ctx.font = 'bold 25px "Comic Sans MS", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(String(i + 1), sx, sy + 1);
      }
    }

    // 7. Visual Stirring Progress Bar if in STIRRING_POT phase
    if (isStirring) {
      const meterY = rimY - 105;
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(cx - 130, meterY - 24, 260, 48, 24);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      const grad = ctx.createLinearGradient(cx - 120, 0, cx + 120, 0);
      grad.addColorStop(0, '#f472b6');
      grad.addColorStop(0.5, '#facc15');
      grad.addColorStop(1, '#4ade80');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(
        cx - 122,
        meterY - 16,
        Math.max(32, 244 * stirProgress),
        32,
        16
      );
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px "Fredoka", "Comic Sans MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🥄 MIX! ✨', cx, meterY + 1);
    }

    ctx.restore();
  }

  private drawMagicCloud(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    progress: number,
    now: number
  ): void {
    ctx.save();
    const wobble = 1 + Math.sin(now * 5) * 0.05;
    ctx.translate(x, y);
    ctx.scale(wobble, wobble);

    // Outer rainbow glow
    const hue = (now * 90) % 360;
    const glow = ctx.createRadialGradient(
      0,
      0,
      radius * 0.2,
      0,
      0,
      radius * 1.5
    );
    glow.addColorStop(0, `hsla(${hue}, 95%, 75%, 0.95)`);
    glow.addColorStop(0.6, `hsla(${(hue + 60) % 360}, 90%, 65%, 0.55)`);
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Fluffy cloud puffs with soft 3D shading
    const puffs = [
      { dx: 0, dy: 0, r: radius * 0.66 },
      { dx: -radius * 0.48, dy: 12, r: radius * 0.49 },
      { dx: radius * 0.48, dy: 12, r: radius * 0.49 },
      { dx: -radius * 0.25, dy: -radius * 0.32, r: radius * 0.47 },
      { dx: radius * 0.25, dy: -radius * 0.32, r: radius * 0.47 },
    ];
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(124, 58, 237, 0.35)';
    ctx.shadowBlur = 18;
    for (const p of puffs) {
      ctx.beginPath();
      ctx.arc(
        p.dx + Math.sin(now * 4 + p.dx) * 4,
        p.dy + Math.cos(now * 4 + p.dy) * 4,
        p.r,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Progress ring
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(
      0,
      0,
      radius * 0.85,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress
    );
    ctx.stroke();

    // Big animated waving hands icon inside cloud (no text needed!)
    ctx.save();
    ctx.rotate(Math.sin(now * 8) * 0.18);
    ctx.font = '64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🙌✨', 0, 2);
    ctx.restore();

    ctx.restore();
  }

  private drawFloatingIngredient(
    ctx: CanvasRenderingContext2D,
    flt: GamePhysics['floatingIngredients'][number],
    cauldronX: number,
    cauldronRimY: number,
    now: number
  ): void {
    ctx.save();

    // Subtle curved guidance arc toward cauldron when moving downward
    if (flt.vy > 40) {
      ctx.save();
      ctx.strokeStyle = flt.item.splashColor + '88';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(flt.x, flt.y);
      ctx.quadraticCurveTo(
        (flt.x + cauldronX) * 0.5,
        flt.y - 40,
        cauldronX,
        cauldronRimY
      );
      ctx.stroke();
      ctx.restore();
    }

    ctx.translate(flt.x, flt.y);

    // Apply springy Squash & Stretch!
    const pulse = 1 + Math.sin(now * 5 + flt.spawnTime) * 0.04;
    const sx = (flt.scaleX || 1) * pulse;
    const sy = (flt.scaleY || 1) * pulse;
    ctx.scale(sx, sy);

    const r = flt.radius;

    // Outer iridescent soap-bubble aura
    const bubbleGrad = ctx.createRadialGradient(
      -r * 0.3,
      -r * 0.3,
      r * 0.08,
      0,
      0,
      r
    );
    bubbleGrad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
    bubbleGrad.addColorStop(0.55, flt.item.splashColor + '55');
    bubbleGrad.addColorStop(0.85, flt.item.splashColor + 'aa');
    bubbleGrad.addColorStop(1, '#ffffff');

    ctx.fillStyle = bubbleGrad;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (flt.isMysteryBubble) {
      ctx.rotate(Math.sin(now * 6) * 0.25);
      ctx.font = `${Math.round(r * 1.05)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🪄', 0, 0);
    } else {
      ctx.save();
      ctx.rotate(flt.rotation);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.32)';
      ctx.shadowBlur = 12;
      const img = flt.imageElement || getCachedSticker(flt.item.imageUrl);
      // Oversized sticker inside the bubble (no text label box underneath!)
      const drawSize = r * 1.66;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      } else {
        ctx.font = `${Math.round(r * 1.12)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(flt.item.emoji || '🌟', 0, 0);
      }
      ctx.restore();
    }

    // Curved specular glossy window highlight on top-left of bubble
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.78, Math.PI * 1.12, Math.PI * 1.42);
    ctx.stroke();

    ctx.restore();
  }

  private drawFeedingSpoon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    scale: number,
    soupColor: string,
    charX: number,
    charY: number,
    now: number
  ): void {
    ctx.save();

    // Animated golden guiding stream from spoon to character mouth
    const dashOffset = -(now * 90) % 32;
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.88)';
    ctx.lineWidth = 8;
    ctx.setLineDash([18, 14]);
    ctx.lineDashOffset = dashOffset;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(charX, charY - 20);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.translate(x, y);
    const bob = Math.sin(now * 5) * 9;
    ctx.translate(0, bob);

    // Scale the entire spoon up 2.6x + dynamic spring scale & tilt!
    const spoonScale = 2.6 * (scale || 1);
    ctx.save();
    ctx.rotate(angle || 0);
    ctx.scale(spoonScale, spoonScale);

    // Golden magic aura
    const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 74);
    glow.addColorStop(0, 'rgba(250, 204, 21, 0.55)');
    glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 74, 0, Math.PI * 2);
    ctx.fill();

    // Spoon handle with wood gradient
    const handleGrad = ctx.createLinearGradient(20, -12, 20, 12);
    handleGrad.addColorStop(0, '#f59e0b');
    handleGrad.addColorStop(0.5, '#d97706');
    handleGrad.addColorStop(1, '#92400e');
    ctx.fillStyle = handleGrad;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(20, -11, 84, 22, 11);
    ctx.fill();
    ctx.stroke();

    // Spoon bowl with colorful soup
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.ellipse(0, 0, 44, 32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = soupColor;
    ctx.beginPath();
    ctx.ellipse(0, -2, 36, 24, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shimmer highlight on the soup in the spoon
    ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
    ctx.beginPath();
    ctx.ellipse(-10, -8, 13, 6, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  private drawBurpBubble(
    ctx: CanvasRenderingContext2D,
    b: GamePhysics['burpBubbles'][number],
    now: number
  ): void {
    ctx.save();
    ctx.translate(b.x, b.y);
    const scaleX = b.scaleX || 1 + Math.sin(now * 6 + b.wobblePhase) * 0.05;
    const scaleY = b.scaleY || 1 + Math.cos(now * 6 + b.wobblePhase) * 0.05;
    ctx.scale(scaleX, scaleY);

    const grad = ctx.createRadialGradient(
      -b.radius * 0.3,
      -b.radius * 0.3,
      b.radius * 0.1,
      0,
      0,
      b.radius
    );
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.55, b.color + '55');
    grad.addColorStop(0.88, b.color + 'bb');
    grad.addColorStop(1, '#ffffff');

    ctx.fillStyle = grad;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (
      b.imageElement &&
      b.imageElement.complete &&
      b.imageElement.naturalWidth > 0
    ) {
      const sz = b.radius * 1.12;
      ctx.drawImage(b.imageElement, -sz / 2, -sz / 2, sz, sz);
    } else {
      ctx.font = `${Math.round(b.radius * 0.85)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.emoji, 0, 0);
    }

    // Curved specular shine arc
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, b.radius * 0.76, Math.PI * 1.1, Math.PI * 1.42);
    ctx.stroke();

    ctx.restore();
  }

  private drawShockwaves(
    ctx: CanvasRenderingContext2D,
    physics: GamePhysics
  ): void {
    for (const sw of physics.shockwaves) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = sw.lineWidth * sw.alpha;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    physics: GamePhysics
  ): void {
    for (const p of physics.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;

      if (p.shape === 'star') {
        this.drawStarPath(ctx, 0, 0, 5, p.radius, p.radius * 0.45);
        ctx.fill();
      } else if (p.shape === 'heart') {
        const r = p.radius * 0.9;
        ctx.beginPath();
        ctx.moveTo(0, r * 0.4);
        ctx.bezierCurveTo(-r, -r * 0.3, -r * 0.6, -r, 0, -r * 0.4);
        ctx.bezierCurveTo(r * 0.6, -r, r, -r * 0.3, 0, r * 0.4);
        ctx.fill();
      } else if (p.shape === 'steam') {
        const steamGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, p.radius);
        steamGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
        steamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = steamGrad;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'bubble') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawHands(
    ctx: CanvasRenderingContext2D,
    hands: HandPoint[],
    handTrails: GamePhysics['handTrails'],
    w: number,
    h: number,
    now: number
  ): void {
    // 1. Draw Silky Magic Starlight Ribbon Trails
    for (const trail of handTrails) {
      if (trail.length < 2) continue;
      for (let i = 1; i < trail.length; i++) {
        const prev = trail[i - 1];
        const curr = trail[i];
        const alpha = Math.max(0, (1 - curr.age) * 0.65);
        const width = Math.max(2, (1 - curr.age) * 26);
        ctx.save();
        ctx.strokeStyle = `rgba(250, 204, 21, ${alpha})`;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. Draw Glowing Hand Orbs
    for (const hand of hands) {
      const hx = hand.x * w;
      const hy = hand.y * h;
      const hr = hand.radius * Math.min(w, h);

      ctx.save();
      ctx.translate(hx, hy);

      const grad = ctx.createRadialGradient(0, 0, hr * 0.1, 0, 0, hr * 1.1);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
      grad.addColorStop(0.45, 'rgba(250, 204, 21, 0.7)');
      grad.addColorStop(0.8, 'rgba(244, 114, 182, 0.35)');
      grad.addColorStop(1, 'rgba(244, 114, 182, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, hr * 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.rotate(now * 2.5);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3.5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, hr * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '34px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hand.isMouse ? '🪄' : '✋', 0, 0);

      ctx.restore();
    }
  }

  private drawStarPath(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    spikes: number,
    outerRadius: number,
    innerRadius: number
  ): void {
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(
        cx + Math.cos(rot) * outerRadius,
        cy + Math.sin(rot) * outerRadius
      );
      rot += step;
      ctx.lineTo(
        cx + Math.cos(rot) * innerRadius,
        cy + Math.sin(rot) * innerRadius
      );
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
  }

  /**
   * Renders Game Mode #2: "Sky Choo-Choo: The Flying Train That Shoots!"
   */
  private renderFlyingTrainMode(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: RenderState,
    physics: GamePhysics,
    now: number
  ): void {
    ctx.save();

    // 1. Dreamy Sky Stage Framing & Twinkling Sky Stars
    const topSky = ctx.createLinearGradient(0, 0, 0, 120);
    topSky.addColorStop(0, 'rgba(14, 116, 144, 0.55)');
    topSky.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = topSky;
    ctx.fillRect(0, 0, w, 120);

    for (let i = 0; i < 14; i++) {
      const sx = ((w - ((now * 65 + i * 173) % w)) + w) % w;
      const sy = 90 + ((i * 97) % Math.max(200, h - 180));
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(now * 3 + i));
      ctx.fillStyle = `rgba(254, 240, 138, ${twinkle * 0.7})`;
      this.drawStarPath(ctx, sx, sy, 4, 7, 3);
      ctx.fill();
    }

    // 2. Animated Rainbow Sky-Track Ribbon underneath the Flying Train
    const railColors = ['#f472b6', '#facc15', '#4ade80', '#38bdf8'];
    railColors.forEach((col, cIdx) => {
      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.48;
      for (let x = 0; x <= w; x += 36) {
        const y =
          physics.trainState.y +
          68 +
          cIdx * 7 +
          Math.sin(x * 0.006 - now * 4.5) * 18;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // 3. Draw Rainbow Steam Puffs trailing behind the Flying Train
    for (const puff of physics.trainSteamPuffs) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, puff.alpha);
      const pg = ctx.createRadialGradient(
        puff.x,
        puff.y,
        puff.radius * 0.1,
        puff.x,
        puff.y,
        puff.radius
      );
      pg.addColorStop(0, '#ffffff');
      pg.addColorStop(0.55, puff.color);
      pg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(puff.x, puff.y, puff.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 4. Draw Sky Targets (Grumpy Storm Clouds, Happy Rainbow Clouds & Giant Pinata Boss)
    for (const target of physics.skyTargets) {
      this.drawSkyTarget(ctx, target, now);
    }

    // 5. Draw Flying Custom Sticker Projectiles
    for (const proj of physics.trainProjectiles) {
      this.drawTrainProjectile(ctx, proj);
    }

    // 6. Draw the 3D Cartoon Flying Steam Locomotive with Flapping Wings & Aiming Smokestack Cannon!
    this.drawFlyingTrain(
      ctx,
      physics.trainState.x,
      physics.trainState.y,
      physics.trainState.tilt,
      physics.trainState.cannonAngle,
      physics.trainState.cannonRecoil,
      physics.trainState.wheelPhase,
      physics.trainState.wingPhase,
      state.character,
      state.activeTrainAmmo || null,
      now
    );

    // 7. Visual Icon-Only Sky Progress Pill at Top-Right (No reading required!)
    if (state.phase !== 'TRAIN_BUBBLE_PARTY') {
      ctx.save();
      const done = physics.trainState.cloudsTransformedCount;
      const total = physics.trainState.totalCloudsInRound;
      const bossActive = physics.trainState.bossSpawnedInWave;

      const icons: string[] = [];
      if (bossActive) {
        icons.push('👑', '🎁', '✨');
      } else {
        for (let i = 0; i < total; i++) {
          icons.push(i < done ? '🌈' : '☁️');
        }
      }
      const statusText = icons.join(' ');
      ctx.font = '24px sans-serif';
      const tw = ctx.measureText(statusText).width;
      const px = w * 0.68;
      const py = 100;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
      ctx.strokeStyle = bossActive ? '#facc15' : 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(px - tw / 2 - 18, py - 20, tw + 36, 40, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(statusText, px, py + 1);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawFlyingTrain(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tilt: number,
    cannonAngle: number,
    cannonRecoil: number,
    wheelPhase: number,
    wingPhase: number,
    coPilot: CharacterItem | null,
    activeAmmo: IngredientItem | null,
    _now: number
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    const scale = 1.25;
    ctx.scale(scale, scale);

    // 1. Back Flapping Golden Wing (behind boiler)
    const wingFlap = Math.sin(wingPhase) * 0.36;
    ctx.save();
    ctx.translate(-10, -25);
    ctx.rotate(wingFlap - 0.25);
    ctx.fillStyle = '#fde047';
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-55, -75, -110, -45);
    ctx.quadraticCurveTo(-75, -10, -85, 10);
    ctx.quadraticCurveTo(-45, 5, 0, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 2. Warm Headlight Beam at the front of the train
    ctx.save();
    const beamGrad = ctx.createLinearGradient(95, -18, 250, -18);
    beamGrad.addColorStop(0, 'rgba(254, 240, 138, 0.65)');
    beamGrad.addColorStop(1, 'rgba(254, 240, 138, 0)');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(95, -24);
    ctx.lineTo(250, -68);
    ctx.lineTo(250, 32);
    ctx.lineTo(95, -10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 3. Train Chassis & Golden Cowcatcher
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#854d0e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(85, 8);
    ctx.lineTo(126, 36);
    ctx.lineTo(82, 36);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Main Base Frame
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(-105, 8, 198, 24, 10);
    ctx.fill();
    ctx.stroke();

    // 4. Cylindrical 3D Red & Gold Boiler
    const boilerGrad = ctx.createLinearGradient(0, -56, 0, 12);
    boilerGrad.addColorStop(0, '#f87171');
    boilerGrad.addColorStop(0.45, '#ef4444');
    boilerGrad.addColorStop(1, '#991b1b');
    ctx.fillStyle = boilerGrad;
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(-22, -52, 114, 62, 18);
    ctx.fill();
    ctx.stroke();

    // Shiny Brass Boiler Bands
    ctx.fillStyle = '#facc15';
    ctx.fillRect(10, -52, 10, 62);
    ctx.fillRect(52, -52, 10, 62);

    // Front Golden Nose Cone & Headlight Lamp
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(90, -21, 22, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.stroke();

    // 5. Engineer's Cab (Royal Purple & Cherry Red) + Co-Pilot Character Window!
    const cabGrad = ctx.createLinearGradient(0, -98, 0, 10);
    cabGrad.addColorStop(0, '#a855f7');
    cabGrad.addColorStop(1, '#6b21a8');
    ctx.fillStyle = cabGrad;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.roundRect(-100, -92, 84, 102, 14);
    ctx.fill();
    ctx.stroke();

    // Arched Gold Roof on Cab
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(-108, -102, 100, 16, 8);
    ctx.fill();
    ctx.stroke();

    // Cab Window showing Co-Pilot Character Sticker!
    ctx.save();
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(-86, -78, 56, 54, 12);
    ctx.fill();
    ctx.stroke();
    ctx.clip();

    if (coPilot) {
      const charImg = coPilot.imageUrl
        ? getCachedSticker(coPilot.imageUrl)
        : null;
      if (charImg) {
        ctx.drawImage(charImg, -84, -76, 52, 52);
      } else {
        ctx.font = '34px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(coPilot.emoji || '🦖', -58, -50);
      }
    } else {
      ctx.font = '32px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👩‍✈️', -58, -50);
    }
    ctx.restore();

    // 6. The Aiming Magic Smokestack Cannon!
    ctx.save();
    ctx.translate(60, -52);
    ctx.rotate(cannonAngle + 0.25);
    const recoilOffset = -cannonRecoil * 14;
    ctx.translate(recoilOffset, 0);

    // Flared Brass & Magenta Magic Cannon Barrel
    const cannonGrad = ctx.createLinearGradient(0, -24, 58, 24);
    cannonGrad.addColorStop(0, '#facc15');
    cannonGrad.addColorStop(0.5, '#ec4899');
    cannonGrad.addColorStop(1, '#a855f7');
    ctx.fillStyle = cannonGrad;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-10, -16);
    ctx.lineTo(48, -26);
    ctx.lineTo(48, 26);
    ctx.lineTo(-10, 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Golden Muzzle Ring
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.ellipse(48, 0, 8, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Show Big Loaded Silly Ammo Badge on the Cannon!
    if (activeAmmo) {
      ctx.save();
      ctx.rotate(-(cannonAngle + 0.25));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.strokeStyle = activeAmmo.splashColor || '#facc15';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(16, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const ammoImg = activeAmmo.imageUrl
        ? getCachedSticker(activeAmmo.imageUrl)
        : null;
      if (ammoImg) {
        ctx.drawImage(ammoImg, -3, -19, 38, 38);
      } else {
        ctx.font = '26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(activeAmmo.emoji || '🧁', 16, 1);
      }
      ctx.restore();
    }
    ctx.restore();

    // 7. Three Spinning Spoked Train Wheels + Coupling Rod
    const wheelXs = [-72, -8, 56];
    wheelXs.forEach((wx) => {
      ctx.save();
      ctx.translate(wx, 34);
      ctx.rotate(wheelPhase);

      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Spokes
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3;
      for (let s = 0; s < 4; s++) {
        const a = (s * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * -20, Math.sin(a) * -20);
        ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
        ctx.stroke();
      }

      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Piston Coupling Rod across wheels
    const rodOffX = Math.cos(wheelPhase) * 10;
    const rodOffY = Math.sin(wheelPhase) * 10;
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-72 + rodOffX, 34 + rodOffY);
    ctx.lineTo(56 + rodOffX, 34 + rodOffY);
    ctx.stroke();

    // 8. Front Flapping Golden Wing (foreground)
    ctx.save();
    ctx.translate(8, -12);
    ctx.rotate(-wingFlap * 0.9 - 0.1);
    const wingGrad = ctx.createLinearGradient(0, 0, -95, -65);
    wingGrad.addColorStop(0, '#fef08a');
    wingGrad.addColorStop(1, '#f59e0b');
    ctx.fillStyle = wingGrad;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-48, -68, -102, -36);
    ctx.quadraticCurveTo(-68, -4, -76, 16);
    ctx.quadraticCurveTo(-36, 12, 0, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  private drawTrainProjectile(
    ctx: CanvasRenderingContext2D,
    proj: {
      item: IngredientItem;
      x: number;
      y: number;
      radius: number;
      rotation: number;
      imageElement?: HTMLImageElement;
    }
  ): void {
    ctx.save();
    ctx.translate(proj.x, proj.y);
    ctx.rotate(proj.rotation);

    const r = proj.radius;
    const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.35);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.6, proj.item.splashColor || '#facc15');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    ctx.fill();

    const img =
      proj.imageElement ||
      (proj.item.imageUrl ? getCachedSticker(proj.item.imageUrl) : null);
    if (img) {
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
    } else {
      ctx.font = `${Math.round(r * 1.35)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(proj.item.emoji || '🧁', 0, 0);
    }

    ctx.restore();
  }

  private drawSkyTarget(
    ctx: CanvasRenderingContext2D,
    target: SkyTarget,
    now: number
  ): void {
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.scale(target.scaleX, target.scaleY);

    const r = target.radius;
    const puffs = [
      { cx: -r * 0.46, cy: r * 0.06, pr: r * 0.52 },
      { cx: r * 0.46, cy: r * 0.06, pr: r * 0.52 },
      { cx: -r * 0.21, cy: -r * 0.28, pr: r * 0.54 },
      { cx: r * 0.22, cy: -r * 0.25, pr: r * 0.52 },
      { cx: 0, cy: r * 0.12, pr: r * 0.58 },
    ];

    // 1. Rainbow Arch above Happy Cloud or Pulsing Ring on Boss Pinata Cloud
    if (target.state === 'happy') {
      const archBands = ['#ef4444', '#facc15', '#4ade80', '#38bdf8', '#a855f7'];
      ctx.save();
      ctx.globalAlpha = 0.85;
      archBands.forEach((col, idx) => {
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.lineWidth = 5.5;
        ctx.arc(0, -r * 0.14, r * (0.94 - idx * 0.085), Math.PI, 0);
        ctx.stroke();
      });
      ctx.restore();
    } else if (target.state === 'boss_pinata') {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Soft Translucent Multi-Lobe Cloud Body (No internal circle stroke lines!)
    ctx.save();
    const cheerHits = Math.max(0, target.maxHp - target.hp);

    // Outer soft rim silhouette (drawn by filling slightly larger circles first)
    ctx.globalAlpha = target.state === 'boss_pinata' ? 0.84 : 0.72;
    ctx.fillStyle =
      target.state === 'grumpy' && cheerHits === 0
        ? 'rgba(226, 232, 240, 0.85)'
        : '#ffffff';
    ctx.beginPath();
    for (const pf of puffs) {
      ctx.moveTo(pf.cx + pf.pr + 4.5, pf.cy);
      ctx.arc(pf.cx, pf.cy, pf.pr + 4.5, 0, Math.PI * 2);
    }
    ctx.fill();

    // Inner fluffy cloud fill (shifts from soft storm-blue -> pastel blush -> rainbow as hits land!)
    if (target.state === 'grumpy') {
      const g = ctx.createLinearGradient(0, -r, 0, r);
      if (cheerHits === 0) {
        // 3 HP left: Soft airy blue-grey cloud (never dark/opaque)
        g.addColorStop(0, '#94a3b8');
        g.addColorStop(1, '#64748b');
      } else if (cheerHits === 1) {
        // 2 HP left: Tickled! Soft lavender & sky tint
        g.addColorStop(0, '#e0f2fe');
        g.addColorStop(0.55, '#c4b5fd');
        g.addColorStop(1, target.rainbowColor);
      } else {
        // 1 HP left: Almost happy! Bright cotton-candy glow
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.45, '#fde047');
        g.addColorStop(1, target.rainbowColor);
      }
      ctx.fillStyle = g;
    } else if (target.state === 'boss_pinata') {
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, '#fde047');
      g.addColorStop(0.5, '#f472b6');
      g.addColorStop(1, '#38bdf8');
      ctx.fillStyle = g;
    } else {
      // Happy Rainbow Cotton-Candy Cloud!
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, target.rainbowColor);
      ctx.fillStyle = g;
    }

    ctx.beginPath();
    for (const pf of puffs) {
      ctx.moveTo(pf.cx + pf.pr, pf.cy);
      ctx.arc(pf.cx, pf.cy, pf.pr, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();

    // 3. Expressive Cartoon Face & 3-Hit Cheer Meter
    if (target.state === 'grumpy') {
      // Draw 3-Hit Cheer Stars above the cloud so the toddler sees each hit cheering it up!
      for (let s = 0; s < target.maxHp; s++) {
        const sx = (s - (target.maxHp - 1) / 2) * (r * 0.42);
        const sy = -r * 0.88;
        const filled = s < cheerHits;
        ctx.font = `${Math.round(r * 0.32)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(filled ? '⭐' : '⚪', sx, sy);
      }

      // Eyes
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.05, r * 0.13, 0, Math.PI * 2);
      ctx.arc(r * 0.25, -r * 0.05, r * 0.13, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-r * 0.23, -r * 0.04, r * 0.065, 0, Math.PI * 2);
      ctx.arc(r * 0.23, -r * 0.04, r * 0.065, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';

      if (cheerHits === 0) {
        // Grumpy eyebrows & pout
        ctx.beginPath();
        ctx.moveTo(-r * 0.4, -r * 0.21);
        ctx.lineTo(-r * 0.12, -r * 0.12);
        ctx.moveTo(r * 0.4, -r * 0.21);
        ctx.lineTo(r * 0.12, -r * 0.12);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, r * 0.26, r * 0.16, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else if (cheerHits === 1) {
        // Surprised "Ooh!" face after 1st hit
        ctx.beginPath();
        ctx.arc(0, r * 0.16, r * 0.1, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Giggly smile & rosy cheeks after 2nd hit!
        ctx.fillStyle = 'rgba(244, 114, 182, 0.55)';
        ctx.beginPath();
        ctx.arc(-r * 0.38, r * 0.08, r * 0.09, 0, Math.PI * 2);
        ctx.arc(r * 0.38, r * 0.08, r * 0.09, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, r * 0.08, r * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }

      // Show ammo sticker badge if it has been hit at least once!
      if (cheerHits > 0) {
        if (target.hitAmmoImage) {
          ctx.drawImage(
            target.hitAmmoImage,
            r * 0.22,
            -r * 0.62,
            r * 0.58,
            r * 0.58
          );
        } else {
          ctx.font = `${Math.round(r * 0.36)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(target.hitAmmoEmoji || '🌈', r * 0.44, -r * 0.34);
        }
      }
    } else if (target.state === 'boss_pinata') {
      // Giant Golden Crown & Hit Hearts!
      ctx.font = `${Math.round(r * 0.44)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👑', 0, -r * 0.76);

      const hearts = '❤️'.repeat(Math.max(1, target.hp));
      ctx.font = `${Math.round(r * 0.22)}px sans-serif`;
      ctx.fillText(hearts, 0, -r * 1.08);

      // Playful Big Eyes & Open Laughing Mouth
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.06, r * 0.085, 0, Math.PI * 2);
      ctx.arc(r * 0.25, -r * 0.06, r * 0.085, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#be185d';
      ctx.beginPath();
      ctx.arc(0, r * 0.14, r * 0.2, 0, Math.PI);
      ctx.fill();
    } else {
      // Happy Squinting Eyes (^ ^), Rosy Cheeks, Big Smile & Caught Ammo Sticker!
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.04, r * 0.12, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.25, -r * 0.04, r * 0.12, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();

      // Rosy Pink Cheeks
      ctx.fillStyle = 'rgba(244, 114, 182, 0.65)';
      ctx.beginPath();
      ctx.arc(-r * 0.4, r * 0.1, r * 0.1, 0, Math.PI * 2);
      ctx.arc(r * 0.4, r * 0.1, r * 0.1, 0, Math.PI * 2);
      ctx.fill();

      // Big Joyful Smile
      ctx.beginPath();
      ctx.arc(0, r * 0.08, r * 0.19, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();

      // Show the silly ammo sticker it caught!
      if (target.hitAmmoImage) {
        ctx.drawImage(
          target.hitAmmoImage,
          r * 0.24,
          -r * 0.62,
          r * 0.6,
          r * 0.6
        );
      } else {
        ctx.font = `${Math.round(r * 0.38)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(target.hitAmmoEmoji || '🌈', r * 0.46, -r * 0.34);
      }
    }

    ctx.restore();
  }
}
