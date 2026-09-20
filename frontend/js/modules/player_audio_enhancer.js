/**
 * player_audio_enhancer.js - Audio Equalizer & Volume Booster Pro Engine for KuraStream 2.0
 *
 * High-performance Web Audio API engine providing volume amplification up to 200%
 * with soft-knee DRC (Dynamic Range Compression) and acoustic equalizer presets
 * (Flat, Bass Boost, Vocal Clarity, Night Mode).
 *
 * Audio Signal Chain:
 * MediaElementAudioSourceNode -> BiquadFilterNode(s) [LowShelf -> Peaking -> HighShelf]
 *                            -> DynamicsCompressorNode (DRC)
 *                            -> GainNode (100% - 200% Volume Boost)
 *                            -> Destination
 */

/**
 * Equalizer and DRC preset configurations.
 * - 'flat': Pass-through without alteration.
 * - 'bass_boost': LowShelf filter at 100Hz with +6dB gain for cinematic punch.
 * - 'vocal_clarity': Peaking filter at 2.5kHz with +5dB gain and HighShelf at 7kHz for dialogue.
 * - 'night_mode': Compressor with threshold -24dB, ratio 12, knee 10, attack 0.003s, release 0.25s.
 */
export const PRESETS = Object.freeze({
  flat: {
    id: 'flat',
    label: 'Flat (Off)',
    description: 'Pass-through without alteration',
    filters: {
      lowShelf: 0,
      midPeak: 0,
      highShelf: 0
    },
    compressor: {
      threshold: 0,
      ratio: 1,
      knee: 0,
      attack: 0.003,
      release: 0.25
    }
  },
  bass_boost: {
    id: 'bass_boost',
    label: 'Bass Boost',
    description: 'LowShelf filter at 100Hz with +6dB gain for cinematic punch',
    filters: {
      lowShelf: 6,
      midPeak: 0,
      highShelf: 0
    },
    compressor: {
      threshold: 0,
      ratio: 1,
      knee: 0,
      attack: 0.003,
      release: 0.25
    }
  },
  vocal_clarity: {
    id: 'vocal_clarity',
    label: 'Vocal Clarity',
    description: 'Peaking filter at 2.5kHz with +5dB gain and HighShelf at 7kHz for dialogue',
    filters: {
      lowShelf: 0,
      midPeak: 5,
      highShelf: 3.5
    },
    compressor: {
      threshold: 0,
      ratio: 1,
      knee: 0,
      attack: 0.003,
      release: 0.25
    }
  },
  night_mode: {
    id: 'night_mode',
    label: 'Night Mode',
    description: 'Dynamic range compression for balanced dialogue and controlled loud effects',
    filters: {
      lowShelf: 0,
      midPeak: 0,
      highShelf: 0
    },
    compressor: {
      threshold: -24,
      ratio: 12,
      knee: 10,
      attack: 0.003,
      release: 0.25
    }
  }
});

/**
 * Returns available preset definitions with id, label, and description.
 *
 * @returns {Array<{ id: string, label: string, description: string }>}
 */
export function getAvailablePresets() {
  return Object.values(PRESETS).map((preset) => ({
    id: preset.id,
    label: preset.label,
    description: preset.description
  }));
}

/**
 * Safely applies a parameter value to an AudioParam with smooth exponential transition.
 *
 * @param {AudioParam} param - Target AudioParam
 * @param {number} value - Target value
 * @param {AudioContext} [audioCtx] - Active AudioContext
 * @param {number} [timeConstant=0.02] - Transition time constant
 */
function applyAudioParam(param, value, audioCtx, timeConstant = 0.02) {
  if (!param) return;
  try {
    if (audioCtx && typeof param.setTargetAtTime === 'function' && audioCtx.state !== 'closed') {
      param.setTargetAtTime(value, audioCtx.currentTime, timeConstant);
    } else {
      param.value = value;
    }
  } catch {
    try {
      param.value = value;
    } catch {
      // AudioParam inaccessible or context closed
    }
  }
}

/**
 * WeakMap cache mapping HTMLMediaElement to existing MediaElementAudioSourceNode and AudioContext.
 * Reusing source nodes prevents DOMException: "HTMLMediaElement already connected to an AudioSourceNode".
 */
const mediaSourceCache = new WeakMap();

/**
 * Initializes the Audio Equalizer & Volume Booster Pro module.
 *
 * @param {HTMLMediaElement} videoElement - Primary player video element
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.gain=1.0] - Initial gain multiplier (1.0 to 2.0, corresponding to 100% - 200%)
 * @param {string} [options.preset='flat'] - Initial preset key ('flat', 'bass_boost', 'vocal_clarity', 'night_mode')
 * @param {Function} [options.onGainChange] - Optional callback fired when gain changes
 * @param {Function} [options.onPresetChange] - Optional callback fired when preset changes
 * @param {Function} [options.onError] - Optional callback fired on audio context or media errors
 * @returns {{
 *   setGain: (multiplier: number) => number,
 *   getGain: () => number,
 *   setPreset: (presetName: string) => boolean,
 *   getAvailablePresets: () => Array<{ id: string, label: string, description: string }>,
 *   getCurrentPreset: () => string,
 *   destroy: () => void,
 *   isSupported: () => boolean,
 *   getAudioContext: () => AudioContext|null,
 *   getNodes: () => Object|null
 * }}
 */
export function initAudioEnhancer(videoElement, options = {}) {
  let isDestroyed = false;
  let currentGain = Math.max(1.0, Math.min(2.0, Number(options.gain) || 1.0));
  let currentPreset = PRESETS[options.preset] ? options.preset : 'flat';

  let audioCtx = null;
  let sourceNode = null;
  let lowShelfNode = null;
  let midPeakNode = null;
  let highShelfNode = null;
  let compressorNode = null;
  let gainNode = null;
  let isFallback = false;

  const unlockEvents = ['click', 'keydown', 'touchstart', 'pointerdown'];

  const removeUnlockListeners = () => {
    if (typeof window !== 'undefined' && window.removeEventListener) {
      unlockEvents.forEach((evt) => {
        window.removeEventListener(evt, handleUnlock, { capture: true });
      });
    }
    if (videoElement && videoElement.removeEventListener) {
      videoElement.removeEventListener('play', handleUnlock);
      videoElement.removeEventListener('playing', handleUnlock);
    }
  };

  const handleUnlock = () => {
    if (!audioCtx || audioCtx.state === 'running' || audioCtx.state === 'closed') {
      removeUnlockListeners();
      return;
    }
    audioCtx.resume().then(() => {
      if (audioCtx.state === 'running') {
        removeUnlockListeners();
      }
    }).catch(() => {
      // Browser still blocking, wait for next user gesture
    });
  };

  const addUnlockListeners = () => {
    if (typeof window !== 'undefined' && window.addEventListener) {
      unlockEvents.forEach((evt) => {
        window.addEventListener(evt, handleUnlock, { capture: true, passive: true });
      });
    }
    if (videoElement && videoElement.addEventListener) {
      videoElement.addEventListener('play', handleUnlock);
      videoElement.addEventListener('playing', handleUnlock);
    }
  };

  try {
    const AudioContextClass = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;

    if (!AudioContextClass || !videoElement) {
      isFallback = true;
    } else {
      // Re-use existing source node if already attached to this video element
      const cached = mediaSourceCache.get(videoElement);
      if (cached && cached.audioCtx && cached.audioCtx.state !== 'closed') {
        audioCtx = cached.audioCtx;
        sourceNode = cached.sourceNode;
        try {
          sourceNode.disconnect();
        } catch {
          // Ignore
        }
      } else {
        audioCtx = new AudioContextClass();
        sourceNode = audioCtx.createMediaElementSource(videoElement);
        mediaSourceCache.set(videoElement, { audioCtx, sourceNode });
      }

      // 1. LowShelf Filter (100Hz) - Bass punch
      lowShelfNode = audioCtx.createBiquadFilter();
      lowShelfNode.type = 'lowshelf';
      lowShelfNode.frequency.value = 100;
      lowShelfNode.gain.value = 0;

      // 2. Peaking Filter (2.5kHz) - Dialogue clarity
      midPeakNode = audioCtx.createBiquadFilter();
      midPeakNode.type = 'peaking';
      midPeakNode.frequency.value = 2500;
      midPeakNode.Q.value = 1.0;
      midPeakNode.gain.value = 0;

      // 3. HighShelf Filter (7kHz) - Treble air & presence
      highShelfNode = audioCtx.createBiquadFilter();
      highShelfNode.type = 'highshelf';
      highShelfNode.frequency.value = 7000;
      highShelfNode.gain.value = 0;

      // 4. Dynamics Compressor (DRC)
      compressorNode = audioCtx.createDynamicsCompressor();
      compressorNode.threshold.value = 0;
      compressorNode.ratio.value = 1;
      compressorNode.knee.value = 0;
      compressorNode.attack.value = 0.003;
      compressorNode.release.value = 0.25;

      // 5. Master Gain Node (100% to 200% volume boost)
      gainNode = audioCtx.createGain();
      gainNode.gain.value = currentGain;

      // Audio Graph Connection:
      // MediaElementAudioSourceNode -> Filters -> Compressor -> GainNode -> Destination
      sourceNode.connect(lowShelfNode);
      lowShelfNode.connect(midPeakNode);
      midPeakNode.connect(highShelfNode);
      highShelfNode.connect(compressorNode);
      compressorNode.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      // Handle suspended audio context (browser autoplay policies)
      if (audioCtx.state === 'suspended') {
        addUnlockListeners();
      }

      if (typeof audioCtx.addEventListener === 'function') {
        audioCtx.addEventListener('statechange', () => {
          if (audioCtx && audioCtx.state === 'running') {
            removeUnlockListeners();
          }
        });
      }
    }
  } catch (err) {
    // Graceful fallback for cross-origin CORS security restrictions or unsupported environment
    isFallback = true;
    if (typeof options.onError === 'function') {
      options.onError(err);
    }
  }

  /**
   * Applies equalizer and compressor settings corresponding to a preset key.
   *
   * @param {string} presetName
   * @returns {boolean}
   */
  const applyPresetInternal = (presetName) => {
    const preset = PRESETS[presetName];
    if (!preset) {
      return false;
    }

    currentPreset = preset.id;

    if (!isFallback && audioCtx) {
      applyAudioParam(lowShelfNode.gain, preset.filters.lowShelf, audioCtx);
      applyAudioParam(midPeakNode.gain, preset.filters.midPeak, audioCtx);
      applyAudioParam(highShelfNode.gain, preset.filters.highShelf, audioCtx);

      applyAudioParam(compressorNode.threshold, preset.compressor.threshold, audioCtx);
      applyAudioParam(compressorNode.ratio, preset.compressor.ratio, audioCtx);
      applyAudioParam(compressorNode.knee, preset.compressor.knee, audioCtx);
      applyAudioParam(compressorNode.attack, preset.compressor.attack, audioCtx);
      applyAudioParam(compressorNode.release, preset.compressor.release, audioCtx);
    }

    if (typeof options.onPresetChange === 'function') {
      options.onPresetChange(currentPreset);
    }
    return true;
  };

  // Apply initial preset
  applyPresetInternal(currentPreset);

  /**
   * Sets the volume boost gain multiplier.
   * Accepts 1.0 to 2.0 (100% to 200% volume boost).
   *
   * @param {number} multiplier
   * @returns {number} The clamped effective gain multiplier
   */
  function setGain(multiplier) {
    if (isDestroyed) return currentGain;
    const num = Number(multiplier);
    currentGain = Math.max(1.0, Math.min(2.0, isNaN(num) ? 1.0 : num));

    if (!isFallback && gainNode && audioCtx) {
      applyAudioParam(gainNode.gain, currentGain, audioCtx, 0.015);
    } else if (isFallback && videoElement) {
      try {
        // Fallback: standard HTML5 video volume cannot exceed 1.0
        videoElement.volume = 1.0;
      } catch {
        // Ignore
      }
    }

    if (typeof options.onGainChange === 'function') {
      options.onGainChange(currentGain);
    }
    return currentGain;
  }

  /**
   * Returns current volume boost multiplier.
   *
   * @returns {number}
   */
  function getGain() {
    return currentGain;
  }

  /**
   * Switches the active EQ filter & DRC compressor preset.
   *
   * @param {string} presetName - One of 'flat', 'bass_boost', 'vocal_clarity', 'night_mode'
   * @returns {boolean} True if preset was applied, false if unknown
   */
  function setPreset(presetName) {
    if (isDestroyed) return false;
    return applyPresetInternal(presetName);
  }

  /**
   * Returns currently active preset name.
   *
   * @returns {string}
   */
  function getCurrentPreset() {
    return currentPreset;
  }

  /**
   * Disconnects audio nodes, closes audio context, and cleans up event listeners.
   */
  function destroy() {
    if (isDestroyed) return;
    isDestroyed = true;

    removeUnlockListeners();

    if (!isFallback) {
      try {
        if (sourceNode) sourceNode.disconnect();
      } catch {
        // Ignore
      }
      try {
        if (lowShelfNode) lowShelfNode.disconnect();
      } catch {
        // Ignore
      }
      try {
        if (midPeakNode) midPeakNode.disconnect();
      } catch {
        // Ignore
      }
      try {
        if (highShelfNode) highShelfNode.disconnect();
      } catch {
        // Ignore
      }
      try {
        if (compressorNode) compressorNode.disconnect();
      } catch {
        // Ignore
      }
      try {
        if (gainNode) gainNode.disconnect();
      } catch {
        // Ignore
      }

      if (videoElement) {
        mediaSourceCache.delete(videoElement);
      }

      if (audioCtx && audioCtx.state !== 'closed') {
        try {
          audioCtx.close().catch(() => {});
        } catch {
          // Ignore
        }
      }
    }
  }

  /**
   * Returns whether Web Audio API enhancement is active or operating in fallback mode.
   *
   * @returns {boolean}
   */
  function isSupported() {
    return !isFallback && !isDestroyed;
  }

  /**
   * Returns the underlying AudioContext instance if available.
   *
   * @returns {AudioContext|null}
   */
  function getAudioContext() {
    return audioCtx;
  }

  /**
   * Returns underlying audio nodes for inspection/testing.
   *
   * @returns {Object|null}
   */
  function getNodes() {
    if (isFallback) return null;
    return {
      source: sourceNode,
      lowShelf: lowShelfNode,
      midPeak: midPeakNode,
      highShelf: highShelfNode,
      compressor: compressorNode,
      gain: gainNode
    };
  }

  return {
    setGain,
    getGain,
    setPreset,
    getAvailablePresets,
    getCurrentPreset,
    destroy,
    isSupported,
    getAudioContext,
    getNodes
  };
}

export default initAudioEnhancer;
