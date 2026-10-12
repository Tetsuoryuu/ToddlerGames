import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandPoint } from '../types.ts';

interface SmoothedHand {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastTime: number;
}

/** Frame-differencing fallback runs on a 320x240 copy of the webcam, cheap enough for every frame. */
const MOTION_W = 320;
const MOTION_H = 240;
/** Luma change (0-255) between consecutive frames that counts a pixel as moving. */
const MOTION_PIXEL_THRESHOLD = 32;
/** Fewer moving pixels than this in a half-frame is sensor noise, not a waving hand. */
const MOTION_MIN_PIXELS = 160;
/**
 * More than this fraction of the whole frame changing at once is a lighting/exposure jump or the
 * camera moving, not a hand. Judged on the whole frame so a child waving a whole arm close to the
 * camera, which can fill most of one half, still counts.
 */
const MOTION_MAX_FRACTION = 0.5;
/** Consecutive MediaPipe detection errors before giving up on it for the motion fallback. */
const MAX_LANDMARKER_FAILURES = 30;

/**
 * Compares two luma frames and returns the centroid of motion in each half of the mirrored
 * screen (slot 0 = screen left, slot 1 = screen right), normalized to 0..1, or null for a half
 * with no meaningful motion. X is mirrored so it lines up with the AR mirror like MediaPipe hands.
 */
export function findMotionCentroids(
  prev: Uint8Array,
  curr: Uint8Array,
  w: number,
  h: number
): Array<{ x: number; y: number } | null> {
  const sumX = [0, 0];
  const sumY = [0, 0];
  const count = [0, 0];
  const halfW = w / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.abs(curr[i] - prev[i]) > MOTION_PIXEL_THRESHOLD) {
        // Mirrored: the right half of the camera image is the left half of the screen
        const slot = x >= halfW ? 0 : 1;
        sumX[slot] += x;
        sumY[slot] += y;
        count[slot]++;
      }
    }
  }

  if (count[0] + count[1] > w * h * MOTION_MAX_FRACTION) {
    return [null, null];
  }
  return [0, 1].map((slot) => {
    const n = count[slot];
    if (n < MOTION_MIN_PIXELS) {
      return null;
    }
    return { x: 1 - sumX[slot] / n / w, y: sumY[slot] / n / h };
  });
}

function smoothPoint(
  prev: SmoothedHand | null | undefined,
  rawX: number,
  rawY: number,
  now: number
): SmoothedHand {
  if (prev && now - prev.lastTime < 250) {
    const dt = Math.max(0.008, (now - prev.lastTime) / 1000);
    const smoothX = prev.x * 0.35 + rawX * 0.65;
    const smoothY = prev.y * 0.35 + rawY * 0.65;
    return {
      x: smoothX,
      y: smoothY,
      vx: (smoothX - prev.x) / dt,
      vy: (smoothY - prev.y) / dt,
      lastTime: now,
    };
  }
  return { x: rawX, y: rawY, vx: 0, vy: 0, lastTime: now };
}

/**
 * Real-time Webcam Hand Tracker using MediaPipe HandLandmarker.
 * Tracks up to 4 hands (so both the 4-year-old and a parent can play together on the AR mirror!).
 * While MediaPipe is still downloading, or if it fails to load or keeps failing to detect, a
 * lightweight frame-differencing motion fallback turns waving in each half of the mirror into a
 * hand. A mouse/touch wand works with or without a webcam.
 */
export class HandTracker {
  private video: HTMLVideoElement;
  private landmarker: HandLandmarker | null = null;
  private smoothedHands: SmoothedHand[] = [];
  private motionHands: Array<SmoothedHand | null> = [null, null];
  private landmarkerFailures = 0;
  private motionCtx: CanvasRenderingContext2D | null = null;
  private prevLuma: Uint8Array | null = null;
  private mouseHand: HandPoint | null = null;
  private lastMousePos: { x: number; y: number; time: number } | null = null;
  private lastVideoTime = -1;
  private webcamReady = false;

  constructor(videoElement: HTMLVideoElement) {
    this.video = videoElement;
    this.setupMouseFallback();
  }

  public async init(): Promise<boolean> {
    // 1. Start Webcam stream
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
      this.video.srcObject = stream;
      await new Promise<void>((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(() => resolve()).catch(() => resolve());
        };
      });
      this.webcamReady = true;
    } catch (err) {
      console.warn('Webcam unavailable, using magical backdrop + mouse/touch wand:', err);
      this.webcamReady = false;
    }

    // 2. Load MediaPipe HandLandmarker
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
      );
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 4,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });
    } catch (err) {
      console.warn('MediaPipe HandLandmarker failed to load, using frame-differencing motion + mouse/touch fallback:', err);
    }

    return this.webcamReady;
  }

  public isWebcamReady(): boolean {
    return this.webcamReady && this.video.readyState >= 2;
  }

  public getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  private setupMouseFallback(): void {
    const updatePointer = (clientX: number, clientY: number) => {
      const nx = clientX / window.innerWidth;
      const ny = clientY / window.innerHeight;
      const now = performance.now();

      let vx = 0;
      let vy = 0;
      if (this.lastMousePos) {
        const dt = Math.max(0.008, (now - this.lastMousePos.time) / 1000);
        vx = (nx - this.lastMousePos.x) / dt;
        vy = (ny - this.lastMousePos.y) / dt;
      }

      this.lastMousePos = { x: nx, y: ny, time: now };
      this.mouseHand = {
        x: nx,
        y: ny,
        vx,
        vy,
        radius: 0.065,
        isMouse: true,
      };
    };

    window.addEventListener('mousemove', (e) => updatePointer(e.clientX, e.clientY));
    window.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length > 0) {
          updatePointer(e.touches[0].clientX, e.touches[0].clientY);
        }
      },
      { passive: true }
    );
  }

  /**
   * Detects hands in the current video frame and returns normalized mirrored coordinates (0..1).
   */
  public detectHands(): HandPoint[] {
    const now = performance.now();
    const hands: HandPoint[] = [];

    if (
      this.landmarker &&
      this.webcamReady &&
      this.video.readyState >= 2 &&
      this.video.currentTime !== this.lastVideoTime
    ) {
      this.lastVideoTime = this.video.currentTime;
      try {
        const result = this.landmarker.detectForVideo(this.video, now);
        const rawLandmarks = result.landmarks || [];

        const nextSmoothed: SmoothedHand[] = [];

        rawLandmarks.forEach((lmList, idx) => {
          // Compute palm center from wrist (0), index MCP (5), middle MCP (9), pinky MCP (17), and middle tip (12)
          const keyIndices = [0, 5, 9, 13, 17, 8, 12];
          let sumX = 0;
          let sumY = 0;
          for (const k of keyIndices) {
            sumX += lmList[k].x;
            sumY += lmList[k].y;
          }
          // Mirror X (1 - x) so moving right in real life moves right on the AR mirror!
          const rawX = 1 - sumX / keyIndices.length;
          const rawY = sumY / keyIndices.length;

          nextSmoothed.push(
            smoothPoint(this.smoothedHands[idx], rawX, rawY, now)
          );
        });

        this.smoothedHands = nextSmoothed;
        this.landmarkerFailures = 0;
      } catch (err) {
        // Ignore a single-frame glitch, but a persistent failure (e.g. lost GPU context) would
        // otherwise leave no webcam input at all, so hand over to the motion fallback
        if (++this.landmarkerFailures >= MAX_LANDMARKER_FAILURES) {
          console.warn('MediaPipe detection keeps failing, switching to motion fallback:', err);
          this.landmarker = null;
        }
      }
    } else if (
      !this.landmarker &&
      this.webcamReady &&
      this.video.readyState >= 2 &&
      this.video.currentTime !== this.lastVideoTime
    ) {
      this.lastVideoTime = this.video.currentTime;
      this.detectMotion(now);
    }

    // Add active webcam hands (forgiving 0.085 normalized hit radius for 4-year-old hands!)
    for (const h of this.smoothedHands) {
      if (now - h.lastTime < 200) {
        hands.push({
          x: h.x,
          y: h.y,
          vx: h.vx,
          vy: h.vy,
          radius: 0.085,
        });
      }
    }

    // Motion blobs are less precise than landmarks, so give them a wider hit radius
    for (const h of this.motionHands) {
      if (h && now - h.lastTime < 200) {
        hands.push({ x: h.x, y: h.y, vx: h.vx, vy: h.vy, radius: 0.1 });
      }
    }

    // Always include mouse/touch wand if recently moved (within last 3 seconds) or if no webcam hands
    if (
      this.mouseHand &&
      this.lastMousePos &&
      (now - this.lastMousePos.time < 2500 || hands.length === 0)
    ) {
      // Decay mouse velocity if stationary
      if (now - this.lastMousePos.time > 80) {
        this.mouseHand.vx *= 0.8;
        this.mouseHand.vy *= 0.8;
      }
      hands.push(this.mouseHand);
    }

    return hands;
  }

  /**
   * Frame-differencing fallback used while MediaPipe is unavailable: downsamples the webcam to
   * 320x240 luma and tracks the centroid of changed pixels in each half of the mirror.
   */
  private detectMotion(now: number): void {
    if (!this.motionCtx) {
      const canvas = document.createElement('canvas');
      canvas.width = MOTION_W;
      canvas.height = MOTION_H;
      this.motionCtx = canvas.getContext('2d', { willReadFrequently: true });
      if (!this.motionCtx) return;
    }

    this.motionCtx.drawImage(this.video, 0, 0, MOTION_W, MOTION_H);
    const rgba = this.motionCtx.getImageData(0, 0, MOTION_W, MOTION_H).data;
    const luma = new Uint8Array(MOTION_W * MOTION_H);
    for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
      luma[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    }

    const prevLuma = this.prevLuma;
    this.prevLuma = luma;
    if (!prevLuma) return;

    const centroids = findMotionCentroids(prevLuma, luma, MOTION_W, MOTION_H);
    this.motionHands = centroids.map((c, slot) =>
      c ? smoothPoint(this.motionHands[slot], c.x, c.y, now) : this.motionHands[slot]
    );
  }
}
