/**
 * player_scrub_preview.js - Timeline Seek Scrub Preview Engine for KuraStream 2.0
 *
 * Real-time video thumbnail preview when hovering / scrubbing over the player progress bar.
 * Uses an offscreen in-memory HTML5 Video element and a Canvas 2D rendering pipeline
 * without requiring server-side sprite pre-rendering.
 */

/**
 * Format seconds into MM:SS or HH:MM:SS timestamp badge.
 *
 * @param {number} seconds
 * @param {boolean} [forceHours=false]
 * @returns {string}
 */
export function formatTime(seconds, forceHours = false) {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    seconds = 0;
  }
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const pad = (num) => (num < 10 ? `0${num}` : `${num}`);

  if (hours > 0 || forceHours) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}

/**
 * Initialize timeline seek scrub preview engine.
 *
 * @param {HTMLElement} progressBarEl - Progress bar element receiving hover events
 * @param {HTMLVideoElement} mainVideoEl - Primary player video element to synchronize from
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.width=160] - Canvas preview width in px
 * @param {number} [options.height=90] - Canvas preview height in px
 * @param {number} [options.throttleMs=50] - Mousemove calculation throttle in ms
 * @param {number} [options.clampPadding=8] - Viewport horizontal boundary clamp padding in px
 * @param {number} [options.duration] - Optional manual duration override
 * @param {string} [options.src] - Optional explicit video source override
 * @param {HTMLElement} [options.container] - Optional parent container for tooltip
 * @returns {{ destroy: () => void, updateSource: (newSrc: string) => void, setDuration: (duration: number) => void, tooltip: HTMLElement, canvas: HTMLCanvasElement, offscreenVideo: HTMLVideoElement }}
 */
export function initScrubPreview(progressBarEl, mainVideoEl, options = {}) {
  if (!progressBarEl || typeof document === 'undefined') {
    return {
      destroy: () => {},
      updateSource: () => {},
      setDuration: () => {},
      tooltip: null,
      canvas: null,
      offscreenVideo: null
    };
  }

  const previewWidth = options.width || 160;
  const previewHeight = options.height || 90;
  const throttleMs = typeof options.throttleMs === 'number' ? options.throttleMs : 50;
  const clampPadding = typeof options.clampPadding === 'number' ? options.clampPadding : 8;

  const canDirectPlay = options.canDirectPlay !== false;
  let manualDuration = (typeof options.duration === 'number' && options.duration > 0)
    ? options.duration
    : null;

  let isDestroyed = false;
  let isSeeking = false;
  let pendingSeekTime = null;
  let seekTimeout = null;
  let throttleTimeout = null;
  let lastMoveTime = 0;
  let lastMoveEvent = null;

  // 1. Offscreen Video Clone (only when canDirectPlay is true)
  let offscreenVideo = null;
  let deferredSrc = '';
  let sourceRequested = false;
  if (canDirectPlay) {
    offscreenVideo = document.createElement('video');
    offscreenVideo.muted = true;
    offscreenVideo.defaultMuted = true;
    // 'none' until the viewer first hovers the timeline: a second <video> that loads at once doubled the bandwidth
    // of every playing episode (with 30 viewers, the Wi-Fi's most precious resource) for a feature few use.
    offscreenVideo.preload = 'none';
    offscreenVideo.playsInline = true;
    offscreenVideo.style.display = 'none';

    if (mainVideoEl && mainVideoEl.crossOrigin) {
      offscreenVideo.crossOrigin = mainVideoEl.crossOrigin;
    } else if (options.crossOrigin) {
      offscreenVideo.crossOrigin = options.crossOrigin;
    }

    // The source is remembered and only attached on first hover (showTooltip -> updateSource).
    deferredSrc = options.src || '';
  }

  // 2. DOM Tooltip Creation (singleton container)
  const targetParent = options.container || progressBarEl;
  let tooltip = targetParent.querySelector('.scrub-preview-tooltip')
    || (progressBarEl.parentElement ? progressBarEl.parentElement.querySelector('.scrub-preview-tooltip') : null);

  let createdTooltip = false;
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'scrub-preview-tooltip';
    targetParent.appendChild(tooltip);
    createdTooltip = true;
  }

  let canvas = tooltip.querySelector('.scrub-preview-canvas') || tooltip.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'scrub-preview-canvas';
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    tooltip.appendChild(canvas);
    if (!canvas.width) canvas.width = previewWidth;
    if (!canvas.height) canvas.height = previewHeight;
  }

  if (!canDirectPlay && canvas) {
    canvas.style.display = 'none';
  }

  let timeBadge = tooltip.querySelector('.scrub-preview-time');
  if (!timeBadge) {
    timeBadge = document.createElement('span');
    timeBadge.className = 'scrub-preview-time';
    timeBadge.textContent = '00:00';
    tooltip.appendChild(timeBadge);
  }

  // Initial hidden state
  tooltip.style.opacity = '0';
  tooltip.style.visibility = 'hidden';
  tooltip.style.pointerEvents = 'none';

  const ctx = canvas.getContext ? canvas.getContext('2d') : null;

  // 3. Helper Functions
  function getDuration() {
    if (typeof manualDuration === 'number' && manualDuration > 0) {
      return manualDuration;
    }
    if (mainVideoEl && !isNaN(mainVideoEl.duration) && mainVideoEl.duration > 0) {
      return mainVideoEl.duration;
    }
    if (offscreenVideo && !isNaN(offscreenVideo.duration) && offscreenVideo.duration > 0) {
      return offscreenVideo.duration;
    }
    return 0;
  }

  function drawFrame() {
    if (isDestroyed || !ctx || !canvas || !offscreenVideo) return;
    try {
      if (offscreenVideo.readyState >= 1) {
        ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
      }
    } catch {
      // Gracefully handle cross-origin or codec errors without throwing
    }
  }

  function seekOffscreen(time) {
    if (isDestroyed || !offscreenVideo || isNaN(time)) return;

    if (Math.abs(offscreenVideo.currentTime - time) < 0.05) {
      drawFrame();
      return;
    }

    if (isSeeking || offscreenVideo.seeking) {
      pendingSeekTime = time;
      return;
    }

    isSeeking = true;
    pendingSeekTime = null;

    if (seekTimeout) clearTimeout(seekTimeout);
    seekTimeout = setTimeout(() => {
      if (isDestroyed) return;
      isSeeking = false;
      if (pendingSeekTime !== null) {
        const nextTime = pendingSeekTime;
        pendingSeekTime = null;
        seekOffscreen(nextTime);
      }
    }, 250);

    try {
      offscreenVideo.currentTime = time;
    } catch {
      isSeeking = false;
    }
  }

  function handleSeeked() {
    if (isDestroyed) return;
    if (seekTimeout) {
      clearTimeout(seekTimeout);
      seekTimeout = null;
    }
    isSeeking = false;
    drawFrame();

    if (pendingSeekTime !== null) {
      const next = pendingSeekTime;
      pendingSeekTime = null;
      seekOffscreen(next);
    }
  }

  function handleVideoError() {
    if (isDestroyed) return;
    isSeeking = false;
    pendingSeekTime = null;
  }

  function updateTooltipPosition(e) {
    if (isDestroyed || !tooltip) return;
    const rect = progressBarEl.getBoundingClientRect();
    const barWidth = rect.width > 0 ? rect.width : (progressBarEl.offsetWidth || 1);
    const tooltipWidth = tooltip.offsetWidth > 0 ? tooltip.offsetWidth : (canvas.width || previewWidth);

    const clientX = (typeof e.clientX === 'number')
      ? e.clientX
      : (rect.left + (typeof e.offsetX === 'number' ? e.offsetX : 0));
    const cursorX = clientX - rect.left;

    // Centered horizontally above cursor: left = cursorX - (tooltipWidth / 2)
    const rawLeft = cursorX - (tooltipWidth / 2);
    const minLeft = clampPadding;
    const maxLeft = Math.max(minLeft, barWidth - tooltipWidth - clampPadding);
    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, rawLeft));

    tooltip.style.left = `${clampedLeft}px`;
  }

  function calculateAndSeek(e) {
    if (isDestroyed) return;
    const duration = getDuration();
    const rect = progressBarEl.getBoundingClientRect();
    const barWidth = rect.width > 0 ? rect.width : (progressBarEl.offsetWidth || 1);

    const offsetX = (typeof e.offsetX === 'number' && e.target === progressBarEl)
      ? e.offsetX
      : (typeof e.clientX === 'number' ? (e.clientX - rect.left) : (e.offsetX || 0));

    const targetTime = duration > 0
      ? Math.max(0, Math.min(duration, (offsetX / barWidth) * duration))
      : 0;

    if (timeBadge) {
      timeBadge.textContent = formatTime(targetTime, duration >= 3600);
    }

    if (duration > 0) {
      seekOffscreen(targetTime);
    }
  }

  function showTooltip() {
    if (isDestroyed || !tooltip) return;
    tooltip.classList.add('visible');
    tooltip.style.visibility = 'visible';
    tooltip.style.opacity = '1';

    // First hover: only now does the preview video start loading
    if (offscreenVideo && !offscreenVideo.src) {
      const src = deferredSrc || (mainVideoEl ? (mainVideoEl.currentSrc || mainVideoEl.src) : '');
      if (src) {
        sourceRequested = true;
        offscreenVideo.preload = 'metadata';
        updateSource(src);
      }
    }
  }

  function hideTooltip() {
    if (isDestroyed || !tooltip) return;
    tooltip.classList.remove('visible');
    tooltip.style.opacity = '0';
    tooltip.style.visibility = 'hidden';
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }
    lastMoveEvent = null;
  }

  // 4. Event Handlers
  function onMouseEnter(e) {
    showTooltip();
    updateTooltipPosition(e);
    calculateAndSeek(e);
  }

  function onMouseMove(e) {
    showTooltip();
    updateTooltipPosition(e);

    lastMoveEvent = e;
    const now = Date.now();
    if (now - lastMoveTime >= throttleMs) {
      lastMoveTime = now;
      calculateAndSeek(e);
    } else {
      if (throttleTimeout) clearTimeout(throttleTimeout);
      throttleTimeout = setTimeout(() => {
        if (isDestroyed) return;
        lastMoveTime = Date.now();
        if (lastMoveEvent) {
          calculateAndSeek(lastMoveEvent);
        }
      }, throttleMs);
    }
  }

  function onMouseLeave() {
    hideTooltip();
  }

  function onMainVideoUpdate() {
    if (isDestroyed) return;
    if (offscreenVideo && !offscreenVideo.src && mainVideoEl) {
      const src = mainVideoEl.currentSrc || mainVideoEl.src;
      if (src) {
        updateSource(src);
      }
    }
  }

  // 5. Attach Listeners
  progressBarEl.addEventListener('mouseenter', onMouseEnter);
  progressBarEl.addEventListener('mousemove', onMouseMove);
  progressBarEl.addEventListener('mouseleave', onMouseLeave);

  if (offscreenVideo) {
    offscreenVideo.addEventListener('seeked', handleSeeked);
    offscreenVideo.addEventListener('error', handleVideoError);
  }

  if (mainVideoEl) {
    mainVideoEl.addEventListener('loadedmetadata', onMainVideoUpdate);
  }

  // 6. Public API Functions
  function updateSource(newSrc) {
    if (isDestroyed || !offscreenVideo) return;
    const rawSrc = newSrc || (mainVideoEl ? (mainVideoEl.currentSrc || mainVideoEl.src) : '') || '';
    const src = rawSrc ? (rawSrc.includes('?') ? `${rawSrc}&preview=1` : `${rawSrc}?preview=1`) : '';
    if (!sourceRequested) {
      // Not hovered yet: remember the address for later instead of downloading it now.
      deferredSrc = rawSrc;
      return;
    }
    if (src && offscreenVideo.src !== src) {
      offscreenVideo.src = src;
      try {
        offscreenVideo.load();
      } catch {
        // Ignore load error
      }
    }
  }

  function setDuration(duration) {
    if (typeof duration === 'number' && !isNaN(duration) && duration >= 0) {
      manualDuration = duration;
    } else {
      manualDuration = null;
    }
  }

  function destroy() {
    if (isDestroyed) return;
    isDestroyed = true;

    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }
    if (seekTimeout) {
      clearTimeout(seekTimeout);
      seekTimeout = null;
    }

    progressBarEl.removeEventListener('mouseenter', onMouseEnter);
    progressBarEl.removeEventListener('mousemove', onMouseMove);
    progressBarEl.removeEventListener('mouseleave', onMouseLeave);

    if (offscreenVideo) {
      offscreenVideo.removeEventListener('seeked', handleSeeked);
      offscreenVideo.removeEventListener('error', handleVideoError);
      try {
        offscreenVideo.pause();
        offscreenVideo.removeAttribute('src');
        offscreenVideo.src = '';
        offscreenVideo.load();
      } catch {
        // Ignore teardown errors
      }
    }

    if (mainVideoEl) {
      mainVideoEl.removeEventListener('loadedmetadata', onMainVideoUpdate);
    }

    if (ctx && canvas) {
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch {
        // Ignore canvas clear errors
      }
    }

    if (createdTooltip && tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
    } else if (tooltip) {
      tooltip.style.opacity = '0';
      tooltip.style.visibility = 'hidden';
      tooltip.classList.remove('visible');
    }
  }

  return {
    destroy,
    updateSource,
    setDuration,
    tooltip,
    canvas,
    offscreenVideo
  };
}

export default initScrubPreview;
