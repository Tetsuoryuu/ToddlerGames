import type {
  BurpBubble,
  FloatingIngredient,
  HandPoint,
  IngredientItem,
  SkyTarget,
  TrainProjectile,
  TrainSteamPuff,
} from '../types.ts';
import { sfx } from '../audio/soundEffects.ts';
import { loadStickerImage } from './stickerUtils.ts';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
  shape: 'circle' | 'star' | 'bubble' | 'heart' | 'steam';
  rotation: number;
  vRot: number;
}

export interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
  lineWidth: number;
}

export interface HandTrailPoint {
  x: number;
  y: number;
  age: number; // 0..1
}

export class GamePhysics {
  public particles: Particle[] = [];
  public shockwaves: ShockwaveRing[] = [];
  public floatingIngredients: FloatingIngredient[] = [];
  public burpBubbles: BurpBubble[] = [];
  public handTrails: HandTrailPoint[][] = [[], []];

  // Flying Train ("Rainbow Cloud Blaster") entities & state
  public trainProjectiles: TrainProjectile[] = [];
  public skyTargets: SkyTarget[] = [];
  public trainSteamPuffs: TrainSteamPuff[] = [];
  public trainState = {
    x: 240,
    y: 360,
    vy: 0,
    tilt: 0,
    cannonAngle: -0.22,
    cannonRecoil: 0,
    wheelPhase: 0,
    wingPhase: 0,
    lastShotTime: 0,
    totalCloudsInRound: 6,
    cloudsSpawnedCount: 0,
    cloudsTransformedCount: 0,
    bossSpawnedInWave: false,
  };

  // 1D Coupled Spring Wave Simulation for the Cauldron Liquid Surface (24 nodes)
  public readonly waveNodeCount = 24;
  public soupWaveHeights: number[] = new Array(24).fill(0);
  private soupWaveVelocities: number[] = new Array(24).fill(0);

  public spoonPos = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    scale: 1,
    active: false,
    spawnTime: 0,
  };

  public spawnShockwave(
    x: number,
    y: number,
    maxRadius: number,
    color = '#ffffff',
    lineWidth = 6
  ): void {
    this.shockwaves.push({
      x,
      y,
      radius: 12,
      maxRadius,
      color,
      alpha: 0.95,
      lineWidth,
    });
  }

  public triggerSoupWave(normX: number, impulse: number): void {
    const centerIdx = Math.max(
      1,
      Math.min(
        this.waveNodeCount - 2,
        Math.round(normX * (this.waveNodeCount - 1))
      )
    );
    for (let i = -3; i <= 3; i++) {
      const idx = centerIdx + i;
      if (idx > 0 && idx < this.waveNodeCount - 1) {
        const falloff = Math.cos((i / 4) * (Math.PI / 2));
        this.soupWaveVelocities[idx] += impulse * falloff;
      }
    }
  }

  public spawnSparkles(
    x: number,
    y: number,
    count: number,
    colors = ['#facc15', '#f472b6', '#38bdf8', '#a855f7', '#4ade80'],
    shape: Particle['shape'] = 'star'
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 290;
      const chosenShape: Particle['shape'] =
        shape === 'star' && i % 5 === 0 ? 'heart' : shape;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 75,
        radius: 6 + Math.random() * 11,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        decay: 0.65 + Math.random() * 0.65,
        shape: chosenShape,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 6,
      });
    }
  }

  public spawnCauldronSplash(
    cauldronX: number,
    cauldronRimY: number,
    color: string
  ): void {
    this.spawnShockwave(cauldronX, cauldronRimY, 210, color, 8);
    this.triggerSoupWave(0.5, 420);

    for (let i = 0; i < 46; i++) {
      const angle = -Math.PI * 0.12 - Math.random() * Math.PI * 0.76;
      const speed = 170 + Math.random() * 380;
      this.particles.push({
        x: cauldronX + (Math.random() - 0.5) * 150,
        y: cauldronRimY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 7 + Math.random() * 15,
        color: i % 3 === 0 ? '#ffffff' : i % 5 === 0 ? '#facc15' : color,
        alpha: 1,
        decay: 0.58 + Math.random() * 0.45,
        shape: i % 3 === 0 ? 'star' : i % 2 === 0 ? 'bubble' : 'circle',
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 5,
      });
    }
  }

  public addFloatingIngredient(
    item: IngredientItem,
    canvasW: number,
    canvasH: number,
    isMysteryBubble = false
  ): FloatingIngredient {
    const uid = `flt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const x = canvasW * (0.34 + Math.random() * 0.36);
    const y = canvasH * (0.22 + Math.random() * 0.15);
    const flt: FloatingIngredient = {
      uid,
      item,
      x,
      y,
      vx: (Math.random() - 0.5) * 105,
      vy: (Math.random() - 0.5) * 50,
      radius: Math.min(canvasW, canvasH) * 0.092,
      rotation: 0,
      vRot: (Math.random() - 0.5) * 1.2,
      scaleX: 0.4,
      scaleY: 1.6,
      squashVel: 0,
      hitCooldown: 0,
      isMysteryBubble,
      spawnTime: performance.now(),
    };

    if (item.imageUrl) {
      void loadStickerImage(item.imageUrl).then((img) => {
        flt.imageElement = img;
      });
    }

    this.floatingIngredients.push(flt);
    this.spawnShockwave(x, y, 130, item.splashColor, 5);
    this.spawnSparkles(x, y, 18, [item.splashColor, '#facc15', '#ffffff']);
    return flt;
  }

  public upgradeMysteryIngredient(uid: string, realItem: IngredientItem): void {
    const flt = this.floatingIngredients.find((f) => f.uid === uid);
    if (!flt) return;
    flt.item = realItem;
    flt.isMysteryBubble = false;
    flt.scaleX = 1.42;
    flt.scaleY = 0.65;
    void loadStickerImage(realItem.imageUrl).then((img) => {
      flt.imageElement = img;
    });
    this.spawnShockwave(flt.x, flt.y, 150, realItem.splashColor, 6);
    this.spawnSparkles(flt.x, flt.y, 26, [
      realItem.splashColor,
      '#ffffff',
      '#facc15',
    ]);
    sfx.playCharacterAppear();
  }

  public spawnBurpBubbles(
    count: number,
    charX: number,
    charY: number,
    canvasW: number,
    canvasH: number,
    ingredients: IngredientItem[],
    colors: string[]
  ): void {
    this.burpBubbles = [];
    const palette = colors.length
      ? colors
      : ['#f472b6', '#38bdf8', '#facc15', '#4ade80', '#c084fc'];

    this.spawnShockwave(charX, charY - 20, 260, palette[0], 8);

    for (let i = 0; i < count; i++) {
      const ing = ingredients[i % Math.max(1, ingredients.length)];
      const angle = -Math.PI * 0.35 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 160 + Math.random() * (canvasW * 0.42);
      const bubble: BurpBubble = {
        uid: `bub-${i}-${Date.now()}`,
        x: charX + 40 + (Math.random() - 0.3) * 110,
        y: charY - 30 + (Math.random() - 0.5) * 90,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        radius: Math.min(canvasW, canvasH) * (0.056 + Math.random() * 0.034),
        color: palette[i % palette.length],
        emoji: ing?.emoji || '✨',
        wobblePhase: Math.random() * Math.PI * 2,
        scaleX: 1.3,
        scaleY: 0.75,
      };
      if (ing?.imageUrl) {
        void loadStickerImage(ing.imageUrl).then((img) => {
          bubble.imageElement = img;
        });
      }
      this.burpBubbles.push(bubble);
    }
  }

  public startFeedingSpoon(cauldronX: number, cauldronRimY: number): void {
    this.spoonPos = {
      x: cauldronX,
      y: cauldronRimY - 115,
      vx: 0,
      vy: -95,
      angle: 0,
      scale: 1.25,
      active: true,
      spawnTime: performance.now(),
    };
    this.spawnShockwave(cauldronX, cauldronRimY - 60, 180, '#facc15', 6);
  }

  private updateSoupWaves(
    dt: number,
    hands: HandPoint[],
    canvasW: number,
    canvasH: number,
    cauldronX: number,
    cauldronRimY: number,
    cauldronRadiusX: number
  ): void {
    const k = 150; // Spring stiffness
    const damp = 4.2; // Damping
    const spread = 0.28; // Neighbor wave transfer

    // Ambient gentle bubbling wave
    const now = performance.now() * 0.004;
    this.soupWaveVelocities[Math.floor(this.waveNodeCount / 2)] +=
      Math.sin(now * 3.1) * 35 * dt;

    // Hand stirring wave excitation
    for (const h of hands) {
      const hx = h.x * canvasW;
      const hy = h.y * canvasH;
      if (
        Math.abs(hx - cauldronX) < cauldronRadiusX * 1.1 &&
        Math.abs(hy - cauldronRimY) < 160
      ) {
        const normX =
          (hx - (cauldronX - cauldronRadiusX)) / (cauldronRadiusX * 2);
        const speed = Math.hypot(h.vx, h.vy);
        if (speed > 0.08) {
          this.triggerSoupWave(normX, (h.vy * 180 + speed * 95) * dt * 12);
        }
      }
    }

    // Hooke's law per wave point
    for (let i = 1; i < this.waveNodeCount - 1; i++) {
      const force =
        -k * this.soupWaveHeights[i] - damp * this.soupWaveVelocities[i];
      this.soupWaveVelocities[i] += force * dt;
      this.soupWaveHeights[i] += this.soupWaveVelocities[i] * dt;
    }

    // Propagate to neighbors
    const leftDeltas = new Array(this.waveNodeCount).fill(0);
    const rightDeltas = new Array(this.waveNodeCount).fill(0);
    for (let j = 0; j < 2; j++) {
      for (let i = 1; i < this.waveNodeCount - 1; i++) {
        leftDeltas[i] =
          spread * (this.soupWaveHeights[i] - this.soupWaveHeights[i - 1]);
        rightDeltas[i] =
          spread * (this.soupWaveHeights[i] - this.soupWaveHeights[i + 1]);
      }
      for (let i = 1; i < this.waveNodeCount - 1; i++) {
        this.soupWaveVelocities[i - 1] += leftDeltas[i];
        this.soupWaveHeights[i - 1] += leftDeltas[i] * 0.5;
        this.soupWaveVelocities[i + 1] += rightDeltas[i];
        this.soupWaveHeights[i + 1] += rightDeltas[i] * 0.5;
      }
    }

    // Pin endpoints
    this.soupWaveHeights[0] = 0;
    this.soupWaveHeights[this.waveNodeCount - 1] = 0;

    // Spawn rising aromatic steam wisps from cauldron surface
    if (Math.random() < 0.22) {
      this.particles.push({
        x: cauldronX + (Math.random() - 0.5) * cauldronRadiusX * 1.35,
        y: cauldronRimY - 6,
        vx: (Math.random() - 0.5) * 28,
        vy: -45 - Math.random() * 40,
        radius: 14 + Math.random() * 18,
        color: '#ffffff',
        alpha: 0.34,
        decay: 0.28 + Math.random() * 0.15,
        shape: 'steam',
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 1.2,
      });
    }
  }

  public update(
    dt: number,
    canvasW: number,
    canvasH: number,
    hands: HandPoint[],
    cauldronX: number,
    cauldronRimY: number,
    cauldronRadiusX: number,
    charX: number,
    charY: number,
    onIngredientDropped: (item: IngredientItem) => void,
    onSpoonFed: () => void,
    onAllBubblesPopped: () => void
  ): void {
    // 0. Update Cauldron Liquid Waves & Steam
    this.updateSoupWaves(
      dt,
      hands,
      canvasW,
      canvasH,
      cauldronX,
      cauldronRimY,
      cauldronRadiusX
    );

    // 1. Update Shockwave Rings
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += (sw.maxRadius - sw.radius) * Math.min(1, dt * 8.5);
      sw.alpha -= dt * 1.85;
      if (sw.alpha <= 0.02) {
        this.shockwaves.splice(i, 1);
      }
    }

    // 2. Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.shape === 'steam') {
        p.vx += Math.sin(performance.now() * 0.003 + i) * 22 * dt;
        p.radius += 12 * dt;
      } else if (p.shape !== 'bubble') {
        p.vy += 310 * dt; // Gravity
        p.vx *= 0.99;
      } else {
        p.vy -= 45 * dt; // Bubbles float up
        p.vx += Math.sin(performance.now() * 0.005 + i) * 30 * dt;
      }
      p.rotation += p.vRot * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // 3. Update Hand Ribbon Trails & Sparkles
    for (let idx = 0; idx < 2; idx++) {
      const trail = this.handTrails[idx];
      for (let j = trail.length - 1; j >= 0; j--) {
        trail[j].age += dt * 3.6;
        if (trail[j].age >= 1) {
          trail.splice(j, 1);
        }
      }
      const h = hands[idx];
      if (h) {
        const hx = h.x * canvasW;
        const hy = h.y * canvasH;
        trail.push({ x: hx, y: hy, age: 0 });
        if (trail.length > 16) trail.shift();

        const speed = Math.hypot(h.vx, h.vy);
        if (speed > 0.3 && Math.random() < 0.5) {
          this.particles.push({
            x: hx + (Math.random() - 0.5) * 26,
            y: hy + (Math.random() - 0.5) * 26,
            vx: (Math.random() - 0.5) * 50,
            vy: -35 - Math.random() * 45,
            radius: 5 + Math.random() * 7,
            color: ['#facc15', '#38bdf8', '#f472b6', '#a855f7'][
              Math.floor(Math.random() * 4)
            ],
            alpha: 0.92,
            decay: 1.5,
            shape: 'star',
            rotation: Math.random() * Math.PI,
            vRot: (Math.random() - 0.5) * 6,
          });
        }
      }
    }

    // 4. Update Floating Ingredients (Squash & Stretch + Magnetic Cauldron Funnel)
    for (let i = this.floatingIngredients.length - 1; i >= 0; i--) {
      const ing = this.floatingIngredients[i];
      if (ing.hitCooldown > 0) {
        ing.hitCooldown = Math.max(0, ing.hitCooldown - dt);
      }

      // Springy cartoon squash & stretch recovery
      const squashDiff = 1 - ing.scaleX;
      ing.squashVel += squashDiff * 48 * dt;
      ing.squashVel *= Math.pow(0.08, dt);
      ing.scaleX += ing.squashVel * dt;
      ing.scaleY = Math.max(0.62, Math.min(1.48, 2 - ing.scaleX));

      // Gentle float physics + air drag
      ing.x += ing.vx * dt;
      ing.y += ing.vy * dt;
      ing.rotation += ing.vRot * dt;
      ing.vRot *= 0.985;

      // Magnetic Cauldron Funnel when moving downward near the pot!
      const dxPot = cauldronX - ing.x;
      const dyPot = cauldronRimY - ing.y;
      const distToPot = Math.hypot(dxPot, dyPot);

      if (ing.vy > 25) {
        ing.vy += 210 * dt; // Gravity toward pot
        if (distToPot < cauldronRadiusX * 2.1 && dyPot > -40) {
          // Gently steer into the center of the cauldron mouth!
          ing.vx += dxPot * 3.2 * dt;
        }
      } else {
        // Buoyant bob in upper half
        ing.vx *= 0.992;
        ing.vy += Math.sin(performance.now() * 0.0035 + i * 1.7) * 24 * dt;
      }

      // Elastic bounce off screen boundaries with squash deformation
      const pad = ing.radius + 22;
      if (ing.x < pad) {
        ing.x = pad;
        ing.vx = Math.abs(ing.vx) * 0.86;
        ing.scaleX = 0.76;
        ing.scaleY = 1.24;
      } else if (ing.x > canvasW - pad) {
        ing.x = canvasW - pad;
        ing.vx = -Math.abs(ing.vx) * 0.86;
        ing.scaleX = 0.76;
        ing.scaleY = 1.24;
      }
      if (ing.y < pad + 72) {
        ing.y = pad + 72;
        ing.vy = Math.abs(ing.vy) * 0.82;
        ing.scaleX = 1.24;
        ing.scaleY = 0.76;
      }

      // Soft separation between multiple floating ingredients
      for (let j = i - 1; j >= 0; j--) {
        const other = this.floatingIngredients[j];
        const ox = ing.x - other.x;
        const oy = ing.y - other.y;
        const od = Math.hypot(ox, oy);
        const minDist = ing.radius + other.radius + 10;
        if (od > 0 && od < minDist) {
          const push = (minDist - od) * 0.5;
          const nx = ox / od;
          const ny = oy / od;
          ing.x += nx * push;
          ing.y += ny * push;
          other.x -= nx * push;
          other.y -= ny * push;
        }
      }

      // Check collision with any hand
      if (ing.hitCooldown <= 0) {
        for (const h of hands) {
          const hx = h.x * canvasW;
          const hy = h.y * canvasH;
          const hr = h.radius * Math.min(canvasW, canvasH);
          const dist = Math.hypot(ing.x - hx, ing.y - hy);

          if (dist < ing.radius + hr * 1.08) {
            // Swat! Assist trajectory toward cauldron mouth with juicy squash & stretch!
            const toPotX = cauldronX - ing.x;
            const toPotY = cauldronRimY - ing.y;
            const toPotLen = Math.max(1, Math.hypot(toPotX, toPotY));

            ing.vx = (toPotX / toPotLen) * 350 + h.vx * canvasW * 0.32;
            ing.vy = Math.max(
              250,
              (toPotY / toPotLen) * 410 + h.vy * canvasH * 0.32
            );
            ing.vRot = (Math.random() - 0.5) * 6.5;
            ing.scaleX = 1.38;
            ing.scaleY = 0.66;
            ing.squashVel = -4.5;
            ing.hitCooldown = 0.18;

            sfx.playBoing();
            this.spawnShockwave(ing.x, ing.y, ing.radius * 1.8, ing.item.splashColor, 5);
            this.spawnSparkles(ing.x, ing.y, 14, [
              ing.item.splashColor,
              '#ffffff',
              '#facc15',
            ]);
            break;
          }
        }
      }

      // Check if ingredient reached the cauldron mouth!
      if (
        Math.abs(ing.x - cauldronX) < cauldronRadiusX * 1.02 &&
        ing.y >= cauldronRimY - 38
      ) {
        const droppedItem = ing.item;
        const dropNormX =
          (ing.x - (cauldronX - cauldronRadiusX)) / (cauldronRadiusX * 2);
        this.floatingIngredients.splice(i, 1);
        sfx.playCauldronSplash();
        this.triggerSoupWave(dropNormX, 520);
        this.spawnCauldronSplash(
          cauldronX,
          cauldronRimY,
          droppedItem.splashColor
        );
        onIngredientDropped(droppedItem);
        continue;
      }

      // If it missed the pot at the bottom, bounce it back up into an arc toward the pot!
      if (ing.y > canvasH - pad) {
        ing.y = canvasH - pad;
        ing.vy = -290;
        ing.vx = (cauldronX - ing.x) * 1.35;
        ing.scaleX = 1.3;
        ing.scaleY = 0.72;
      }
    }

    // 5. Update Feeding Spoon (Spring Tilt + Magnetic Mouth Assist + Droplets)
    if (this.spoonPos.active) {
      this.spoonPos.x += this.spoonPos.vx * dt;
      this.spoonPos.y += this.spoonPos.vy * dt;
      this.spoonPos.vx *= 0.94;
      this.spoonPos.vy *= 0.94;
      this.spoonPos.scale += (1 - this.spoonPos.scale) * Math.min(1, dt * 8);

      // Dynamic tilt angle based on velocity
      const targetAngle = Math.max(
        -0.38,
        Math.min(0.38, -this.spoonPos.vx * 0.00065)
      );
      this.spoonPos.angle +=
        (targetAngle - this.spoonPos.angle) * Math.min(1, dt * 12);

      // Gentle magnetic pull toward character mouth once pushed left of center
      const toCharX = charX - this.spoonPos.x;
      const toCharY = charY - 20 - this.spoonPos.y;
      const distToChar = Math.hypot(toCharX, toCharY);
      if (this.spoonPos.x < canvasW * 0.46 && distToChar > 10) {
        this.spoonPos.vx += (toCharX / distToChar) * 420 * dt;
        this.spoonPos.vy += (toCharY / distToChar) * 420 * dt;
      }

      // Check hand push on spoon -> guide toward character mouth
      // (Wait 950ms after spoon rises out of pot so residual stirring motion doesn't auto-launch it!)
      const spoonReady = performance.now() - this.spoonPos.spawnTime > 950;
      if (spoonReady) {
        for (const h of hands) {
          const hx = h.x * canvasW;
          const hy = h.y * canvasH;
          const hr = h.radius * Math.min(canvasW, canvasH);
          const dist = Math.hypot(this.spoonPos.x - hx, this.spoonPos.y - hy);
          if (dist < 170 + hr) {
            const len = Math.max(1, distToChar);
            this.spoonPos.vx = (toCharX / len) * 560;
            this.spoonPos.vy = (toCharY / len) * 560;
            this.spoonPos.scale = 1.22;
            sfx.playMagicChime(0.7);
            this.spawnShockwave(
              this.spoonPos.x,
              this.spoonPos.y,
              130,
              '#facc15',
              5
            );
            this.spawnSparkles(this.spoonPos.x, this.spoonPos.y, 10);
            break;
          }
        }
      }

      // Check if spoon reached character!
      if (spoonReady && distToChar < 250) {
        this.spoonPos.active = false;
        sfx.playGulp();
        this.spawnShockwave(charX, charY - 20, 260, '#facc15', 9);
        this.spawnSparkles(charX, charY - 20, 36);
        onSpoonFed();
      }
    }

    // 6. Update Burp Bubbles (Elastic Bubble-Bubble Repulsion + Shockwave Pop)
    if (this.burpBubbles.length > 0) {
      for (let i = this.burpBubbles.length - 1; i >= 0; i--) {
        const b = this.burpBubbles[i];
        b.wobblePhase += 3.2 * dt;
        b.x += (b.vx + Math.sin(b.wobblePhase) * 38) * dt;
        b.y += (b.vy + Math.cos(b.wobblePhase * 0.8) * 18) * dt;

        // Smooth scale recovery
        b.scaleX = 1 + Math.sin(b.wobblePhase * 1.8) * 0.06;
        b.scaleY = 1 + Math.cos(b.wobblePhase * 1.8) * 0.06;

        // Dampen initial burst velocity into a buoyant float
        b.vx *= 0.972;
        b.vy = b.vy * 0.965 - 20 * dt;

        // Elastic bubble-to-bubble repulsion so bubbles spread out nicely
        for (let j = i - 1; j >= 0; j--) {
          const other = this.burpBubbles[j];
          const dx = b.x - other.x;
          const dy = b.y - other.y;
          const dist = Math.hypot(dx, dy);
          const minDist = b.radius + other.radius + 6;
          if (dist > 0 && dist < minDist) {
            const overlap = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;
            b.x += nx * overlap;
            b.y += ny * overlap;
            other.x -= nx * overlap;
            other.y -= ny * overlap;
            b.vx += nx * 35;
            b.vy += ny * 35;
            other.vx -= nx * 35;
            other.vy -= ny * 35;
          }
        }

        // Keep bubbles inside screen bounds so the toddler can pop every single one
        const margin = b.radius + 18;
        if (b.x < margin) {
          b.x = margin;
          b.vx = Math.abs(b.vx) + 45;
        } else if (b.x > canvasW - margin) {
          b.x = canvasW - margin;
          b.vx = -Math.abs(b.vx) - 45;
        }
        if (b.y < margin + 78) {
          b.y = margin + 78;
          b.vy = Math.abs(b.vy) + 45;
        } else if (b.y > canvasH - margin) {
          b.y = canvasH - margin;
          b.vy = -Math.abs(b.vy) - 55;
        }

        // Check hand pop!
        let popped = false;
        for (const h of hands) {
          const hx = h.x * canvasW;
          const hy = h.y * canvasH;
          const hr = h.radius * Math.min(canvasW, canvasH);
          if (Math.hypot(b.x - hx, b.y - hy) < b.radius + hr * 1.15) {
            popped = true;
            break;
          }
        }

        if (popped) {
          this.burpBubbles.splice(i, 1);
          sfx.playBubblePop();
          this.spawnShockwave(b.x, b.y, b.radius * 2.1, b.color, 5);
          this.spawnSparkles(b.x, b.y, 14, [b.color, '#ffffff', '#facc15']);
          if (this.burpBubbles.length === 0) {
            onAllBubblesPopped();
          }
        }
      }
    }
  }

  /**
   * Spawns a spacious sky journey of 6 Grumpy Storm Clouds (at most 2 active on screen at once,
   * each needing 3 silly ammo hits to cheer up into a Happy Rainbow Cloud!).
   */
  public spawnSkyTargetWave(canvasW: number, canvasH: number): void {
    this.skyTargets = [];
    this.trainProjectiles = [];
    this.burpBubbles = [];
    this.trainState.totalCloudsInRound = 6;
    this.trainState.cloudsSpawnedCount = 0;
    this.trainState.cloudsTransformedCount = 0;
    this.trainState.bossSpawnedInWave = false;

    // Spawn only 2 widely spaced clouds initially (upper sky & lower sky) so the AR Mirror stays open & clear!
    this.spawnSingleGrumpyCloud(canvasW, canvasH, 0, canvasW * 0.58);
    this.spawnSingleGrumpyCloud(canvasW, canvasH, 1, canvasW * 0.77);
  }

  private spawnSingleGrumpyCloud(
    canvasW: number,
    canvasH: number,
    slotIndex: number,
    initialX?: number
  ): void {
    if (this.trainState.cloudsSpawnedCount >= this.trainState.totalCloudsInRound) {
      return;
    }

    const idx = this.trainState.cloudsSpawnedCount++;
    const baseR = Math.min(canvasW, canvasH) * 0.082;
    const palette = [
      { color: '#f472b6', label: 'Grumpy Rumble' },
      { color: '#facc15', label: 'Sleepy Storm' },
      { color: '#38bdf8', label: 'Pouty Thunder' },
      { color: '#4ade80', label: 'Grumble Puff' },
      { color: '#c084fc', label: 'Drizzle Snooze' },
      { color: '#fb923c', label: 'Mopey Nimbus' },
    ];
    const cfg = palette[idx % palette.length];

    // Alternate upper-sky and lower-sky lanes so clouds never overlap or crowd each other
    const laneY =
      slotIndex % 2 === 0
        ? canvasH * (0.27 + (idx % 2) * 0.05)
        : canvasH * (0.63 - (idx % 2) * 0.05);
    const x = initialX ?? canvasW * 0.84;

    this.skyTargets.push({
      uid: `cloud-${Date.now()}-${idx}`,
      x,
      y: laneY,
      baseY: laneY,
      vx: (idx % 2 === 0 ? -1 : 1) * 24,
      vy: 0,
      radius: baseR,
      wobblePhase: idx * 1.6,
      scaleX: 0.65,
      scaleY: 1.3,
      squashVel: 0,
      state: 'grumpy',
      hp: 3,
      maxHp: 3,
      hitCooldown: 0.35,
      rainbowColor: cfg.color,
      hitAmmoEmoji: '🌈',
      happyLeaveTimer: 0,
      label: cfg.label,
    });
    this.spawnShockwave(x, laneY, baseR * 1.4, cfg.color, 4);
  }

  /**
   * Spawns the Giant Golden Pinata Boss Cloud after all 6 Grumpy Storm Clouds are turned into Rainbow Clouds!
   */
  public spawnBossPinataCloud(canvasW: number, canvasH: number): void {
    this.trainState.bossSpawnedInWave = true;
    const x = canvasW * 0.68;
    const y = canvasH * 0.48;
    const r = Math.min(canvasW, canvasH) * 0.145;

    this.skyTargets.push({
      uid: `boss-pinata-${Date.now()}`,
      x,
      y,
      baseY: y,
      vx: 26,
      vy: 0,
      radius: r,
      wobblePhase: 0,
      scaleX: 0.5,
      scaleY: 1.4,
      squashVel: 0,
      state: 'boss_pinata',
      hp: 6,
      maxHp: 6,
      hitCooldown: 0.5,
      rainbowColor: '#facc15',
      hitAmmoEmoji: '👑',
      happyLeaveTimer: 0,
      label: 'Giant Golden Pinata Cloud',
    });

    sfx.playCharacterAppear();
    this.spawnShockwave(x, y, r * 1.8, '#facc15', 7);
    this.spawnSparkles(x, y, 36, ['#facc15', '#f472b6', '#38bdf8', '#4ade80']);
  }

  /**
   * Fires a silly ammo sticker projectile from the Flying Train's Magic Smokestack Cannon!
   */
  public fireTrainProjectile(
    ammo: IngredientItem,
    targetX: number,
    targetY: number,
    canvasW: number,
    canvasH: number
  ): void {
    const startX = this.trainState.x + 76;
    const startY = this.trainState.y - 98;
    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const speed = Math.max(520, canvasW * 0.44);

    const angle = Math.atan2(dy, dx);
    this.trainState.cannonAngle = Math.max(-1.1, Math.min(0.45, angle));
    this.trainState.cannonRecoil = 1.0;

    const proj: TrainProjectile = {
      uid: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      item: ammo,
      x: startX,
      y: startY,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      radius: Math.min(canvasW, canvasH) * 0.052,
      rotation: 0,
      vRot: (Math.random() > 0.5 ? 1 : -1) * 5.2,
    };

    if (ammo.imageUrl) {
      void loadStickerImage(ammo.imageUrl).then((img) => {
        proj.imageElement = img;
      });
    }

    this.trainProjectiles.push(proj);
    sfx.playTrainCannonShot();

    // Light, airy cannon puff & sparkles at cannon muzzle
    const puffColors = ['#f472b6', '#facc15', '#38bdf8', '#4ade80', '#c084fc'];
    for (let i = 0; i < 2; i++) {
      this.trainSteamPuffs.push({
        x: startX + (Math.random() - 0.5) * 12,
        y: startY + (Math.random() - 0.5) * 12,
        vx: -30 + Math.random() * 60,
        vy: -55 - Math.random() * 40,
        radius: 10 + Math.random() * 9,
        alpha: 0.48,
        color:
          ammo.splashColor ||
          puffColors[Math.floor(Math.random() * puffColors.length)],
      });
    }
    this.spawnSparkles(startX, startY, 7, [
      ammo.splashColor || '#facc15',
      '#ffffff',
      '#facc15',
    ]);
  }

  public upgradeTrainAmmo(realItem: IngredientItem): void {
    void loadStickerImage(realItem.imageUrl).then((img) => {
      for (const p of this.trainProjectiles) {
        p.item = realItem;
        p.imageElement = img;
      }
    });
  }

  /**
   * 60 FPS Physics Update for Game Mode #2: "Sky Choo-Choo: The Flying Train That Shoots!"
   */
  public updateFlyingTrain(
    dt: number,
    canvasW: number,
    canvasH: number,
    hands: HandPoint[],
    activeAmmo: IngredientItem | null,
    isBlastingPhase: boolean,
    onCloudTransformed: (cloud: SkyTarget, remainingCount: number) => void,
    onBossSpawned: () => void,
    onBossPinataBurst: () => void,
    onAllBubblesPopped: () => void
  ): void {
    const now = performance.now();

    // 1. Update Hand Ribbon Trails
    for (let hIdx = 0; hIdx < 2; hIdx++) {
      const trail = this.handTrails[hIdx];
      const hand = hands[hIdx];
      if (hand) {
        trail.unshift({
          x: hand.x * canvasW,
          y: hand.y * canvasH,
          age: 0,
        });
      }
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].age += dt * 4.2;
        if (trail[i].age >= 1 || i > 14) {
          trail.splice(i, 1);
        }
      }
    }

    // 2. Update Shockwaves & Particles
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += (sw.maxRadius - sw.radius) * Math.min(1, dt * 9.5);
      sw.alpha -= dt * 2.2;
      if (sw.alpha <= 0.02) {
        this.shockwaves.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 240 * dt;
      p.rotation += p.vRot * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // 3. Update Flying Train Position, Wings, Wheels & Airy Steam Trail
    const targetTrainX = canvasW * 0.2 + Math.sin(now * 0.0025) * 14;
    this.trainState.x = targetTrainX;

    let desiredTrainY = canvasH * 0.52 + Math.sin(now * 0.0032) * 32;
    let aimTargetX = canvasW * 0.68;
    let aimTargetY = canvasH * 0.45;
    let maxHandSpeed = 0;
    let handPointedTarget: SkyTarget | null = null;

    if (hands.length > 0) {
      // Pick the most active hand for aiming, and steer train altitude smoothly
      const primaryHand = hands.reduce((best, cur) =>
        Math.hypot(cur.vx, cur.vy) > Math.hypot(best.vx, best.vy) ? cur : best
      );
      const hy = Math.max(
        canvasH * 0.24,
        Math.min(canvasH * 0.76, primaryHand.y * canvasH)
      );
      desiredTrainY = hy;
      aimTargetX = Math.max(this.trainState.x + 180, primaryHand.x * canvasW);
      aimTargetY = primaryHand.y * canvasH;
      maxHandSpeed = Math.hypot(primaryHand.vx, primaryHand.vy);

      // Check if a hand is directly pointing over an active cloud
      for (const h of hands) {
        const hx = h.x * canvasW;
        const hyPx = h.y * canvasH;
        const hr = h.radius * Math.min(canvasW, canvasH);
        for (const t of this.skyTargets) {
          if (
            (t.state === 'grumpy' || t.state === 'boss_pinata') &&
            Math.hypot(t.x - hx, t.y - hyPx) < t.radius + hr * 0.95
          ) {
            handPointedTarget = t;
            break;
          }
        }
        if (handPointedTarget) break;
      }
    } else {
      // Aim toward the first active grumpy or boss cloud
      const activeTarget = this.skyTargets.find(
        (t) => t.state === 'grumpy' || t.state === 'boss_pinata'
      );
      if (activeTarget) {
        aimTargetX = activeTarget.x;
        aimTargetY = activeTarget.y;
      }
    }

    const dyTrain = desiredTrainY - this.trainState.y;
    this.trainState.vy += (dyTrain * 14 - this.trainState.vy * 6.5) * dt;
    this.trainState.y += this.trainState.vy * dt;
    this.trainState.tilt = Math.max(
      -0.22,
      Math.min(0.22, this.trainState.vy * 0.00085)
    );
    this.trainState.wheelPhase += dt * 9.5;
    this.trainState.wingPhase += dt * 11.0;
    this.trainState.cannonRecoil = Math.max(
      0,
      this.trainState.cannonRecoil - dt * 4.5
    );

    const desiredAngle = Math.atan2(
      aimTargetY - (this.trainState.y - 98),
      aimTargetX - (this.trainState.x + 76)
    );
    const clampedAngle = Math.max(-1.05, Math.min(0.45, desiredAngle));
    this.trainState.cannonAngle +=
      (clampedAngle - this.trainState.cannonAngle) * Math.min(1, dt * 10);

    // Subtle, translucent rainbow steam puffs behind the flying train (never dense!)
    if (Math.random() < dt * 4.5) {
      const colors = ['#f472b6', '#38bdf8', '#facc15', '#4ade80', '#c084fc'];
      this.trainSteamPuffs.push({
        x: this.trainState.x - 95,
        y: this.trainState.y + 18 + (Math.random() - 0.5) * 16,
        vx: -135 - Math.random() * 45,
        vy: (Math.random() - 0.5) * 20,
        radius: 10 + Math.random() * 8,
        alpha: 0.36,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    for (let i = this.trainSteamPuffs.length - 1; i >= 0; i--) {
      const puff = this.trainSteamPuffs[i];
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.radius += 14 * dt;
      puff.alpha -= 0.65 * dt;
      if (puff.alpha <= 0.02) {
        this.trainSteamPuffs.splice(i, 1);
      }
    }

    // 4. Player-Driven Cannon Firing (Only shoots when player moves hands or touches a cloud, with a 680ms rhythm!)
    const activeTargets = this.skyTargets.filter(
      (t) => t.state === 'grumpy' || t.state === 'boss_pinata'
    );
    const playerActivelyFiring =
      hands.length > 0 && (maxHandSpeed > 0.15 || handPointedTarget !== null);

    if (
      isBlastingPhase &&
      activeAmmo &&
      activeTargets.length > 0 &&
      playerActivelyFiring
    ) {
      const fireInterval = handPointedTarget ? 540 : 680;
      if (now - this.trainState.lastShotTime > fireInterval) {
        this.trainState.lastShotTime = now;
        const chosenTarget =
          handPointedTarget ||
          activeTargets.reduce((best, cur) =>
            Math.hypot(cur.x - aimTargetX, cur.y - aimTargetY) <
            Math.hypot(best.x - aimTargetX, best.y - aimTargetY)
              ? cur
              : best
          );
        const mixX = chosenTarget.x * 0.72 + aimTargetX * 0.28;
        const mixY = chosenTarget.y * 0.72 + aimTargetY * 0.28;
        this.fireTrainProjectile(activeAmmo, mixX, mixY, canvasW, canvasH);
      }
    }

    // 5. Update Sky Targets (Grumpy Clouds, Happy Rainbow Clouds & Giant Pinata Boss)
    for (let i = this.skyTargets.length - 1; i >= 0; i--) {
      const t = this.skyTargets[i];
      t.wobblePhase += dt * 2.6;
      if (t.hitCooldown > 0) {
        t.hitCooldown = Math.max(0, t.hitCooldown - dt);
      }

      // Elastic squash-and-stretch recovery
      const forceX = (1 - t.scaleX) * 34;
      t.squashVel = (t.squashVel + forceX * dt) * Math.pow(0.05, dt);
      t.scaleX += t.squashVel * dt;
      t.scaleY = Math.max(0.55, Math.min(1.5, 2 - t.scaleX));

      if (t.state === 'happy') {
        t.happyLeaveTimer -= dt;
        // Stay and smile in the sky for ~2.5s before floating gently up and away!
        if (t.happyLeaveTimer < 1.8) {
          t.y -= 42 * dt;
        } else {
          t.y += Math.sin(t.wobblePhase * 2) * 14 * dt;
        }
        t.x += Math.sin(t.wobblePhase * 1.4) * 22 * dt;
        if (t.happyLeaveTimer <= 0 || t.y < -t.radius * 1.6) {
          this.skyTargets.splice(i, 1);
          continue;
        }
      } else {
        // Bob gently in the sky on the right half of the screen
        t.x += t.vx * dt;
        t.y =
          t.baseY +
          Math.sin(t.wobblePhase) * (t.state === 'boss_pinata' ? 30 : 18);
        const minX = canvasW * 0.48;
        const maxX = canvasW * 0.82;
        if (t.x < minX) {
          t.x = minX;
          t.vx = Math.abs(t.vx);
        } else if (t.x > maxX) {
          t.x = maxX;
          t.vx = -Math.abs(t.vx);
        }
      }
    }

    // Keep up to 2 Grumpy Clouds in the sky until all 6 in the round have spawned
    const currentGrumpyCount = this.skyTargets.filter(
      (st) => st.state === 'grumpy'
    ).length;
    if (
      currentGrumpyCount < 2 &&
      this.trainState.cloudsSpawnedCount < this.trainState.totalCloudsInRound &&
      !this.trainState.bossSpawnedInWave
    ) {
      // Pick the vertical lane opposite the remaining grumpy cloud so they never overlap
      const existing = this.skyTargets.find((st) => st.state === 'grumpy');
      const nextLane =
        existing && existing.baseY < canvasH * 0.45 ? 1 : 0;
      this.spawnSingleGrumpyCloud(canvasW, canvasH, nextLane);
    }

    // 6. Update Flying Projectiles + Gentle Homing + Progressive Multi-Hit Cloud Reactions
    for (let i = this.trainProjectiles.length - 1; i >= 0; i--) {
      const p = this.trainProjectiles[i];

      // Magnetic homing toward nearest active Grumpy or Boss cloud
      const liveTargets = this.skyTargets.filter(
        (t) => t.state === 'grumpy' || t.state === 'boss_pinata'
      );
      if (liveTargets.length > 0) {
        const nearest = liveTargets.reduce((best, cur) =>
          Math.hypot(cur.x - p.x, cur.y - p.y) <
          Math.hypot(best.x - p.x, best.y - p.y)
            ? cur
            : best
        );
        const dx = nearest.x - p.x;
        const dy = nearest.y - p.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        p.vx += (dx / dist) * 820 * dt;
        p.vy += (dy / dist) * 820 * dt;
        const spd = Math.hypot(p.vx, p.vy);
        const maxSpd = Math.max(560, canvasW * 0.48);
        if (spd > maxSpd) {
          p.vx = (p.vx / spd) * maxSpd;
          p.vy = (p.vy / spd) * maxSpd;
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vRot * dt;

      // Subtle sparkle trail behind flying ammo
      if (Math.random() < 0.25) {
        this.particles.push({
          x: p.x,
          y: p.y,
          vx: (Math.random() - 0.5) * 35,
          vy: (Math.random() - 0.5) * 35,
          radius: 4 + Math.random() * 5,
          color: p.item.splashColor || '#facc15',
          alpha: 0.75,
          decay: 2.0,
          shape: 'star',
          rotation: Math.random() * Math.PI,
          vRot: 3,
        });
      }

      // Check collision with active sky targets
      let hit = false;
      for (const target of this.skyTargets) {
        if (target.state !== 'grumpy' && target.state !== 'boss_pinata') {
          continue;
        }
        const dist = Math.hypot(p.x - target.x, p.y - target.y);
        if (dist < p.radius + target.radius * 0.9) {
          hit = true;
          if (target.hitCooldown > 0) {
            break;
          }

          target.hp = Math.max(0, target.hp - 1);
          target.hitCooldown = 0.46;
          target.scaleX = 1.38;
          target.scaleY = 0.66;
          target.squashVel = -3.8;
          target.hitAmmoEmoji = p.item.emoji;
          if (p.imageElement) {
            target.hitAmmoImage = p.imageElement;
          }

          this.spawnShockwave(
            target.x,
            target.y,
            target.radius * 1.65,
            target.rainbowColor,
            5
          );
          this.spawnSparkles(target.x, target.y, 16, [
            target.rainbowColor,
            p.item.splashColor || '#facc15',
            '#ffffff',
          ]);

          if (target.state === 'grumpy') {
            if (target.hp > 0) {
              // Tickled / Partially Cheered Up!
              sfx.playBoing();
              sfx.playMagicChime(1 - target.hp / target.maxHp);
            } else {
              // All 3 hits landed -> Full Happy Rainbow Cotton-Candy Cloud!
              target.state = 'happy';
              target.happyLeaveTimer = 4.2;
              this.trainState.cloudsTransformedCount++;
              sfx.playCloudTransform();

              const remainingInRound = Math.max(
                0,
                this.trainState.totalCloudsInRound -
                  this.trainState.cloudsTransformedCount
              );
              onCloudTransformed(target, remainingInRound);

              if (
                remainingInRound === 0 &&
                !this.trainState.bossSpawnedInWave
              ) {
                this.spawnBossPinataCloud(canvasW, canvasH);
                onBossSpawned();
              }
            }
          } else if (target.state === 'boss_pinata') {
            if (target.hp > 0) {
              sfx.playBoing();
              sfx.playCloudTransform();
            } else {
              // Boss Pinata Cloud burst open after 6 hits!
              target.state = 'happy';
              target.happyLeaveTimer = 3.5;
              sfx.playTrainWhistle();
              sfx.playCloudTransform();
              onBossPinataBurst();
            }
          }
          break;
        }
      }

      if (
        hit ||
        p.x > canvasW + 120 ||
        p.x < -120 ||
        p.y < -120 ||
        p.y > canvasH + 120
      ) {
        this.trainProjectiles.splice(i, 1);
      }
    }

    // 7. Update Poppable Sky Bubbles during TRAIN_BUBBLE_PARTY
    if (this.burpBubbles.length > 0) {
      for (let i = this.burpBubbles.length - 1; i >= 0; i--) {
        const b = this.burpBubbles[i];
        b.wobblePhase += 3.2 * dt;
        b.x += (b.vx + Math.sin(b.wobblePhase) * 38) * dt;
        b.y += (b.vy + Math.cos(b.wobblePhase * 0.8) * 18) * dt;
        b.scaleX = 1 + Math.sin(b.wobblePhase * 1.8) * 0.06;
        b.scaleY = 1 + Math.cos(b.wobblePhase * 1.8) * 0.06;
        b.vx *= 0.972;
        b.vy = b.vy * 0.965 - 20 * dt;

        const margin = b.radius + 18;
        if (b.x < margin) {
          b.x = margin;
          b.vx = Math.abs(b.vx) + 45;
        } else if (b.x > canvasW - margin) {
          b.x = canvasW - margin;
          b.vx = -Math.abs(b.vx) - 45;
        }
        if (b.y < margin + 78) {
          b.y = margin + 78;
          b.vy = Math.abs(b.vy) + 45;
        } else if (b.y > canvasH - margin) {
          b.y = canvasH - margin;
          b.vy = -Math.abs(b.vy) - 55;
        }

        let popped = false;
        for (const h of hands) {
          const hx = h.x * canvasW;
          const hy = h.y * canvasH;
          const hr = h.radius * Math.min(canvasW, canvasH);
          if (Math.hypot(b.x - hx, b.y - hy) < b.radius + hr * 1.15) {
            popped = true;
            break;
          }
        }

        if (popped) {
          this.burpBubbles.splice(i, 1);
          sfx.playBubblePop();
          this.spawnShockwave(b.x, b.y, b.radius * 2.1, b.color, 5);
          this.spawnSparkles(b.x, b.y, 14, [b.color, '#ffffff', '#facc15']);
          if (this.burpBubbles.length === 0) {
            onAllBubblesPopped();
          }
        }
      }
    }
  }
}
