const imageCache = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<HTMLImageElement>>();

/**
 * Loads an image URL and, if it is a raster PNG from Nano Banana 2.1,
 * automatically removes the solid outer background using a 4-corner flood-fill
 * so it renders as a true transparent die-cut sticker on the AR webcam mirror!
 */
export function loadStickerImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);

  const existingPromise = loadingPromises.get(url);
  if (existingPromise) return existingPromise;

  const promise = new Promise<HTMLImageElement>((resolve) => {
    const rawImg = new Image();
    rawImg.crossOrigin = 'anonymous';

    rawImg.onload = () => {
      // SVG data URLs already have transparent backgrounds
      if (url.startsWith('data:image/svg+xml')) {
        imageCache.set(url, rawImg);
        loadingPromises.delete(url);
        resolve(rawImg);
        return;
      }

      try {
        removeOuterBackgroundAndCrop(rawImg).then((processed) => {
          imageCache.set(url, processed);
          loadingPromises.delete(url);
          resolve(processed);
        });
      } catch {
        imageCache.set(url, rawImg);
        loadingPromises.delete(url);
        resolve(rawImg);
      }
    };

    rawImg.onerror = () => {
      loadingPromises.delete(url);
      resolve(rawImg);
    };

    rawImg.src = url;
  });

  loadingPromises.set(url, promise);
  return promise;
}

export function getCachedSticker(url: string): HTMLImageElement | undefined {
  const cached = imageCache.get(url);
  if (!cached) {
    void loadStickerImage(url);
  }
  return cached;
}

function removeOuterBackgroundAndCrop(
  img: HTMLImageElement
): Promise<HTMLImageElement> {
  const srcW = img.naturalWidth || img.width || 768;
  const srcH = img.naturalHeight || img.height || 768;
  const maxWorkDim = 768;
  const workScale = Math.min(1, maxWorkDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * workScale));
  const h = Math.max(1, Math.round(srcH * workScale));

  const workCanvas = document.createElement('canvas');
  workCanvas.width = w;
  workCanvas.height = h;
  const ctx = workCanvas.getContext('2d');
  if (!ctx) return Promise.resolve(img);

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Sample corner color (top-left)
  const bgR = data[0];
  const bgG = data[1];
  const bgB = data[2];

  const totalPixels = w * h;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let head = 0;
  let tail = 0;

  const colorDist = (idx: number): number => {
    const dr = data[idx] - bgR;
    const dg = data[idx + 1] - bgG;
    const db = data[idx + 2] - bgB;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const pos = y * w + x;
    if (visited[pos]) return;
    const pixelIdx = pos * 4;
    const r = data[pixelIdx];
    const g = data[pixelIdx + 1];
    const b = data[pixelIdx + 2];
    const dist = colorDist(pixelIdx);
    // Also check if pixel is bright neutral white/off-white background
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const isNearWhite = r > 228 && g > 228 && b > 228 && maxC - minC < 24;
    if (dist < 46 || isNearWhite) {
      visited[pos] = 1;
      queue[tail++] = pos;
    }
  };

  // Seed flood fill from all 4 outer edges
  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  while (head < tail) {
    const pos = queue[head++];
    const pixelIdx = pos * 4;
    data[pixelIdx + 3] = 0; // Make outer background completely transparent

    const x = pos % w;
    const y = (pos / w) | 0;

    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  // Feather edge alpha slightly for smooth cartoon anti-aliasing & strip any 1px white fringe
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const pos = y * w + x;
      if (!visited[pos]) {
        const neighborsTransparent =
          visited[pos - 1] +
          visited[pos + 1] +
          visited[pos - w] +
          visited[pos + w];
        if (neighborsTransparent > 0) {
          const idx = pos * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          if (r > 238 && g > 238 && b > 238) {
            data[idx + 3] = 0;
          } else {
            data[idx + 3] = Math.min(data[idx + 3], 200);
          }
        }
      }
    }
  }

  // Find tight bounding box of non-transparent sticker pixels so the item fills the whole container!
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 25) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const outSize = 512;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outSize;
  outCanvas.height = outSize;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return Promise.resolve(img);

  if (maxX >= minX && maxY >= minY) {
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    // Scale tightly-cropped subject to fill 95% of the square container
    const targetSpan = outSize * 0.95;
    const scale = targetSpan / Math.max(cropW, cropH);
    const drawW = cropW * scale;
    const drawH = cropH * scale;
    const dx = (outSize - drawW) / 2;
    const dy = (outSize - drawH) / 2;

    outCtx.drawImage(
      workCanvas,
      minX,
      minY,
      cropW,
      cropH,
      dx,
      dy,
      drawW,
      drawH
    );
  } else {
    outCtx.drawImage(workCanvas, 0, 0, outSize, outSize);
  }

  return new Promise<HTMLImageElement>((resolve) => {
    const outImg = new Image();
    outImg.onload = () => resolve(outImg);
    outImg.onerror = () => resolve(outImg);
    outImg.src = outCanvas.toDataURL('image/png');
  });
}
