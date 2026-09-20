/**
 * hero_ambient_glow.js - Dynamic Ambient Color Extraction & Hero Backdrop Glow for KuraStream 2.0
 *
 * High-performance Canvas 2D ambient color extraction that downsamples billboard and detail
 * hero backdrops onto a 16x16 offscreen canvas, derives vibrant accent colors with weighted
 * chrominance filtering without blocking the UI thread, and updates CSS custom properties
 * with smooth transitions and subtle radial gradient aura lighting.
 */

export const DEFAULT_ACCENT_RGB = [249, 115, 22]; // #F97316
export const DEFAULT_SECONDARY_RGB = [234, 88, 12]; // #EA580C
export const DEFAULT_ACCENT_STR = '249, 115, 22';
export const DEFAULT_LUMINANCE = 0.536;

const STYLE_ID = 'kura-hero-ambient-styles';
const DEFAULT_SAMPLE_SIZE = 16;
const DEFAULT_GLOW_OPACITY = 0.38;
const DEFAULT_TRANSITION = '0.5s ease';

/**
 * Calculates standard relative luminance for an RGB tuple.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function calculateLuminance(r, g, b) {
  return Number(((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255).toFixed(3));
}

/**
 * Ensures ambient glow CSS custom properties and transitions are registered.
 *
 * @param {string} [transitionDuration='0.5s ease']
 * @returns {HTMLStyleElement|null}
 */
function ensureAmbientStyles(transitionDuration = DEFAULT_TRANSITION) {
  if (typeof document === 'undefined') {
    return null;
  }

  let styleEl = document.getElementById(STYLE_ID);
  if (styleEl) {
    return styleEl;
  }

  styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
    :root {
      --hero-ambient-rgb: ${DEFAULT_ACCENT_STR};
      --hero-ambient-glow: rgba(var(--hero-ambient-rgb), ${DEFAULT_GLOW_OPACITY});
    }

    .billboard-hero,
    .detail-hero-banner,
    .has-ambient-glow {
      --hero-ambient-rgb: ${DEFAULT_ACCENT_STR};
      --hero-ambient-glow: rgba(var(--hero-ambient-rgb), ${DEFAULT_GLOW_OPACITY});
      transition: --hero-ambient-rgb ${transitionDuration},
                  --hero-ambient-glow ${transitionDuration},
                  box-shadow ${transitionDuration};
    }

    .billboard-hero.has-ambient-glow,
    .detail-hero-banner.has-ambient-glow {
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7),
                  0 0 80px -15px var(--hero-ambient-glow);
    }

    .hero-ambient-aura-layer {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: radial-gradient(circle at 65% 25%, rgba(var(--hero-ambient-rgb), 0.35) 0%, rgba(var(--hero-ambient-rgb), 0.12) 42%, transparent 70%);
      pointer-events: none;
      z-index: 1;
      opacity: 1;
      transition: opacity ${transitionDuration}, background ${transitionDuration};
      mix-blend-mode: screen;
    }
  `;

  if (document.head) {
    document.head.appendChild(styleEl);
  }

  return styleEl;
}

/**
 * Creates or retrieves an offscreen canvas context for image downsampling.
 *
 * @param {number} size
 * @returns {{ canvas: HTMLCanvasElement|OffscreenCanvas, ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D }|null}
 */
function createOffscreenCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const offscreen = new OffscreenCanvas(size, size);
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        return { canvas: offscreen, ctx };
      }
    } catch {
      // Fallback to DOM canvas
    }
  }

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const canvas = document.createElement('canvas');
      if (canvas && typeof canvas.getContext === 'function') {
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          return { canvas, ctx };
        }
      }
    } catch {
      // Fallback if canvas context is unavailable
    }
  }

  return null;
}

/**
 * Loads an image from URL with CORS enabled and timeout handling.
 *
 * @param {string} src
 * @param {number} [timeoutMs=6000]
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    if (!src || typeof src !== 'string') {
      reject(new Error('Invalid image source URL'));
      return;
    }

    if (typeof Image === 'undefined') {
      reject(new Error('Image constructor unavailable in current environment'));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    let timer = null;

    const cleanUp = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      img.onload = null;
      img.onerror = null;
    };

    timer = setTimeout(() => {
      cleanUp();
      img.src = '';
      reject(new Error(`Timeout loading image: ${src}`));
    }, timeoutMs);

    img.onload = () => {
      cleanUp();
      resolve(img);
    };

    img.onerror = () => {
      cleanUp();
      reject(new Error(`Failed to load image: ${src}`));
    };

    img.src = src;

    if (img.complete && img.naturalWidth > 0) {
      cleanUp();
      resolve(img);
    }
  });
}

/**
 * Analyzes pixel buffer from downsampled canvas and derives vibrant dominant colors.
 * Excludes pure blacks, pure whites, and muddy greys with chromatic vibrancy weighting.
 *
 * @param {Uint8ClampedArray} data - RGBA pixel data
 * @param {number} sampleSize
 * @returns {{ primary: [number, number, number], secondary: [number, number, number], luminance: number }}
 */
function analyzePixels(data, sampleSize) {
  const numPixels = sampleSize * sampleSize;
  const bins = Array.from({ length: 12 }, (_, i) => ({
    index: i,
    totalWeight: 0,
    sumR: 0,
    sumG: 0,
    sumB: 0,
    count: 0,
  }));

  let overallWeight = 0;

  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    // Exclude transparent or semi-transparent pixels
    if (a < 128) {
      continue;
    }

    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;

    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

    // Exclude pure blacks (very dark shadows)
    if (lightness < 0.12 || max < 0.12) {
      continue;
    }

    // Exclude pure whites and near-white specular highlights
    if (lightness > 0.88 && saturation < 0.15) {
      continue;
    }
    if (min > 0.90) {
      continue;
    }

    // Exclude muddy greys (monochromatic or drab pixels)
    if (saturation < 0.16) {
      continue;
    }

    // Vibrancy weighting: peak at high saturation and balanced mid-luminance
    const weight = Math.pow(saturation, 1.25) * (1.0 - Math.abs(lightness - 0.5) * 1.3);
    if (weight <= 0) {
      continue;
    }

    // Hue angle calculation: 0 to 360 degrees
    let hue = 0;
    if (delta > 0) {
      if (max === rn) {
        hue = ((gn - bn) / delta) % 6;
      } else if (max === gn) {
        hue = (bn - rn) / delta + 2;
      } else {
        hue = (rn - gn) / delta + 4;
      }
      hue = Math.round(hue * 60);
      if (hue < 0) {
        hue += 360;
      }
    }

    const binIndex = Math.min(11, Math.floor(hue / 30));
    const bin = bins[binIndex];
    bin.totalWeight += weight;
    bin.sumR += r * weight;
    bin.sumG += g * weight;
    bin.sumB += b * weight;
    bin.count++;

    overallWeight += weight;
  }

  // Graceful fallback if no vibrant pixels qualified
  if (overallWeight <= 0) {
    return {
      primary: [...DEFAULT_ACCENT_RGB],
      secondary: [...DEFAULT_SECONDARY_RGB],
      luminance: DEFAULT_LUMINANCE,
    };
  }

  const populatedBins = bins.filter((b) => b.totalWeight > 0).sort((a, b) => b.totalWeight - a.totalWeight);
  const bestBin = populatedBins[0];

  const primary = [
    Math.round(bestBin.sumR / bestBin.totalWeight),
    Math.round(bestBin.sumG / bestBin.totalWeight),
    Math.round(bestBin.sumB / bestBin.totalWeight),
  ];

  let secondary;
  const secondBin = populatedBins.find((b) => b.index !== bestBin.index);
  if (secondBin && secondBin.totalWeight > 0.05 * bestBin.totalWeight) {
    secondary = [
      Math.round(secondBin.sumR / secondBin.totalWeight),
      Math.round(secondBin.sumG / secondBin.totalWeight),
      Math.round(secondBin.sumB / secondBin.totalWeight),
    ];
  } else {
    // Generate a deep harmonious secondary variant from primary
    secondary = [
      Math.max(0, Math.min(255, Math.round(primary[0] * 0.82))),
      Math.max(0, Math.min(255, Math.round(primary[1] * 0.82))),
      Math.max(0, Math.min(255, Math.round(primary[2] * 0.82))),
    ];
  }

  const luminance = calculateLuminance(primary[0], primary[1], primary[2]);

  return { primary, secondary, luminance };
}

/**
 * Initializes the Dynamic Ambient Color Extraction & Hero Backdrop Glow engine.
 *
 * @param {Object} [options={}] - Configuration options
 * @param {Array<number>} [options.defaultColor=[249, 115, 22]] - Fallback RGB color
 * @param {number} [options.sampleSize=16] - Offscreen canvas sampling size in pixels
 * @param {number} [options.glowOpacity=0.38] - Ambient glow aura opacity
 * @param {string} [options.transitionDuration='0.5s ease'] - CSS transition duration
 * @param {boolean} [options.manageAura=true] - Whether to inject backdrop aura layer
 * @param {boolean} [options.autoInjectStyles=true] - Whether to automatically inject CSS styles
 * @returns {{
 *   extractAndApplyGlow: (imageSourceUrl: string, targetElement: HTMLElement|string) => Promise<{ primary: [number, number, number], secondary: [number, number, number], luminance: number }>,
 *   extractPalette: (imageSourceUrl: string, sampleSize?: number) => Promise<{ primary: [number, number, number], secondary: [number, number, number], luminance: number }>,
 *   resetGlow: (targetElement?: HTMLElement|string) => void,
 *   destroy: () => void
 * }}
 */
export function initHeroAmbientGlow(options = {}) {
  const defaultColor = Array.isArray(options.defaultColor) && options.defaultColor.length === 3
    ? options.defaultColor
    : [...DEFAULT_ACCENT_RGB];

  const defaultSecondary = Array.isArray(options.defaultSecondary) && options.defaultSecondary.length === 3
    ? options.defaultSecondary
    : [...DEFAULT_SECONDARY_RGB];

  const sampleSize = typeof options.sampleSize === 'number' && options.sampleSize > 0
    ? options.sampleSize
    : DEFAULT_SAMPLE_SIZE;

  const glowOpacity = typeof options.glowOpacity === 'number'
    ? options.glowOpacity
    : DEFAULT_GLOW_OPACITY;

  const transitionDuration = options.transitionDuration || DEFAULT_TRANSITION;
  const manageAura = options.manageAura !== false;
  const autoInjectStyles = options.autoInjectStyles !== false;

  if (autoInjectStyles) {
    ensureAmbientStyles(transitionDuration);
  }

  let canvasBundle = createOffscreenCanvas(sampleSize);
  const paletteCache = new Map();
  const trackedElements = new Set();

  /**
   * Helper to resolve target element by selector or reference.
   *
   * @param {HTMLElement|string} [target]
   * @returns {HTMLElement|null}
   */
  const resolveTarget = (target) => {
    if (typeof document === 'undefined') {
      return null;
    }
    if (typeof target === 'string') {
      return document.querySelector(target);
    }
    if (target && target.nodeType === 1) {
      return target;
    }
    return document.querySelector('.billboard-hero, .detail-hero-banner');
  };

  /**
   * Samples image colors and derives primary/secondary aesthetic colors.
   *
   * @param {string} imageSourceUrl
   * @param {number} [overrideSampleSize]
   * @returns {Promise<{ primary: [number, number, number], secondary: [number, number, number], luminance: number }>}
   */
  const extractPalette = async (imageSourceUrl, overrideSampleSize = sampleSize) => {
    const fallback = {
      primary: [...defaultColor],
      secondary: [...defaultSecondary],
      luminance: calculateLuminance(defaultColor[0], defaultColor[1], defaultColor[2]),
    };

    if (!imageSourceUrl || typeof imageSourceUrl !== 'string') {
      return fallback;
    }

    const cacheKey = `${imageSourceUrl}__${overrideSampleSize}`;
    if (paletteCache.has(cacheKey)) {
      return paletteCache.get(cacheKey);
    }

    try {
      const img = await loadImage(imageSourceUrl);

      // Refresh canvas bundle if needed
      if (!canvasBundle || canvasBundle.canvas.width !== overrideSampleSize) {
        canvasBundle = createOffscreenCanvas(overrideSampleSize);
      }

      if (!canvasBundle || !canvasBundle.ctx) {
        return fallback;
      }

      const { ctx } = canvasBundle;
      ctx.clearRect(0, 0, overrideSampleSize, overrideSampleSize);
      ctx.drawImage(img, 0, 0, overrideSampleSize, overrideSampleSize);

      const imageData = ctx.getImageData(0, 0, overrideSampleSize, overrideSampleSize);
      const result = analyzePixels(imageData.data, overrideSampleSize);

      // Keep cache size bounded
      if (paletteCache.size >= 120) {
        const oldestKey = paletteCache.keys().next().value;
        paletteCache.delete(oldestKey);
      }

      paletteCache.set(cacheKey, result);
      return result;
    } catch {
      // Graceful fallback on CORS rejection, decoding failure, or network errors
      return fallback;
    }
  };

  /**
   * Extracts ambient color from image source and applies CSS custom properties to target element.
   *
   * @param {string} imageSourceUrl
   * @param {HTMLElement|string} targetElement
   * @returns {Promise<{ primary: [number, number, number], secondary: [number, number, number], luminance: number }>}
   */
  const extractAndApplyGlow = async (imageSourceUrl, targetElement) => {
    const palette = await extractPalette(imageSourceUrl);
    const element = resolveTarget(targetElement);

    if (element) {
      trackedElements.add(element);

      const rgbStr = `${palette.primary[0]}, ${palette.primary[1]}, ${palette.primary[2]}`;
      const glowStr = `rgba(${rgbStr}, ${glowOpacity})`;

      // Schedule style update via requestAnimationFrame without blocking UI thread
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          element.style.setProperty('--hero-ambient-rgb', rgbStr);
          element.style.setProperty('--hero-ambient-glow', glowStr);
          element.classList.add('has-ambient-glow');

          if (manageAura) {
            let aura = element.querySelector('.hero-ambient-aura-layer');
            if (!aura) {
              aura = document.createElement('div');
              aura.className = 'hero-ambient-aura-layer';
              aura.setAttribute('aria-hidden', 'true');
              if (element.firstChild) {
                element.insertBefore(aura, element.firstChild);
              } else {
                element.appendChild(aura);
              }
            }
          }
        });
      } else {
        element.style.setProperty('--hero-ambient-rgb', rgbStr);
        element.style.setProperty('--hero-ambient-glow', glowStr);
        element.classList.add('has-ambient-glow');
      }
    }

    return palette;
  };

  /**
   * Restores default ambient color properties and resets glow on target element.
   *
   * @param {HTMLElement|string} [targetElement]
   */
  const resetGlow = (targetElement) => {
    const defaultRgbStr = `${defaultColor[0]}, ${defaultColor[1]}, ${defaultColor[2]}`;
    const defaultGlowStr = `rgba(${defaultRgbStr}, ${glowOpacity})`;

    const elementsToReset = targetElement
      ? [resolveTarget(targetElement)].filter(Boolean)
      : Array.from(trackedElements);

    if (elementsToReset.length === 0 && typeof document !== 'undefined') {
      const defaultHeroes = document.querySelectorAll('.billboard-hero, .detail-hero-banner, .has-ambient-glow');
      elementsToReset.push(...Array.from(defaultHeroes));
    }

    elementsToReset.forEach((el) => {
      if (!el || !el.style) return;
      el.style.setProperty('--hero-ambient-rgb', defaultRgbStr);
      el.style.setProperty('--hero-ambient-glow', defaultGlowStr);
    });
  };

  /**
   * Cleans up internal canvas references, caches, and tracked DOM elements.
   */
  const destroy = () => {
    resetGlow();
    paletteCache.clear();
    trackedElements.clear();

    if (canvasBundle) {
      if (canvasBundle.canvas && typeof canvasBundle.canvas.remove === 'function') {
        try {
          canvasBundle.canvas.remove();
        } catch {
          // OffscreenCanvas does not have .remove
        }
      }
      canvasBundle = null;
    }

    if (typeof document !== 'undefined') {
      const auras = document.querySelectorAll('.hero-ambient-aura-layer');
      auras.forEach((aura) => {
        if (aura && aura.parentNode) {
          aura.parentNode.removeChild(aura);
        }
      });
    }
  };

  return {
    extractAndApplyGlow,
    extractPalette,
    resetGlow,
    destroy,
  };
}

// Global default instance for convenience exports
let defaultInstance = null;

function getDefaultInstance() {
  if (!defaultInstance) {
    defaultInstance = initHeroAmbientGlow();
  }
  return defaultInstance;
}

/**
 * Convenience method to extract palette using default instance.
 *
 * @param {string} imageSourceUrl
 * @param {number} [sampleSize=16]
 * @returns {Promise<{ primary: [number, number, number], secondary: [number, number, number], luminance: number }>}
 */
export function extractPalette(imageSourceUrl, sampleSize = DEFAULT_SAMPLE_SIZE) {
  return getDefaultInstance().extractPalette(imageSourceUrl, sampleSize);
}

/**
 * Convenience method to extract and apply glow using default instance.
 *
 * @param {string} imageSourceUrl
 * @param {HTMLElement|string} targetElement
 * @returns {Promise<{ primary: [number, number, number], secondary: [number, number, number], luminance: number }>}
 */
export function extractAndApplyGlow(imageSourceUrl, targetElement) {
  return getDefaultInstance().extractAndApplyGlow(imageSourceUrl, targetElement);
}

/**
 * Convenience method to reset glow on an element using default instance.
 *
 * @param {HTMLElement|string} [targetElement]
 */
export function resetGlow(targetElement) {
  getDefaultInstance().resetGlow(targetElement);
}

export default initHeroAmbientGlow;
