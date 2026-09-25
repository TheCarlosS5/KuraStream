/**
 * KuraStream v2.0 - Player Feature Controller
 * Encapsulates the video player lifecycle, SubtitlesOctopus / libass worker teardown,
 * progress tracking, and in-browser QR code sharing.
 */

import { api } from '../../core/api.js';
import { appState } from '../../core/state.js';
import { renderQRCodeToElement } from './qr_generator.js';

export class PlayerController {
  constructor() {
    this.container = null;
    this.videoElement = null;
    this.currentEpisodeId = null;
    this.progressInterval = null;
    this.isMounted = false;
    this.subtitlesOctopusInstance = null;
  }

  /**
   * Mounts the player inside the specified container DOM element.
   */
  mount(container, videoElement = null) {
    if (!container) return;
    this.container = container;
    this.videoElement = videoElement || container.querySelector('video');
    this.isMounted = true;
    appState.set('isPlayerActive', true);
  }

  /**
   * Loads and begins playback for an episode ID
   */
  async loadEpisode(episodeId) {
    if (!episodeId) return null;
    this.currentEpisodeId = episodeId;

    try {
      const res = await api.get(`/api/episodes/${encodeURIComponent(episodeId)}`);
      const episodeData = res.data;
      appState.set('currentEpisode', episodeData);

      if (this.videoElement) {
        this.videoElement.src = `/api/stream/${encodeURIComponent(episodeId)}`;
        this.startProgressTracking();
      }

      return episodeData;
    } catch (err) {
      console.error('[PlayerController] Error loading episode:', err);
      throw err;
    }
  }

  /**
   * Starts periodic progress reporting to sync continue watching state
   */
  startProgressTracking() {
    this.stopProgressTracking();
    this.progressInterval = setInterval(() => {
      if (!this.videoElement || this.videoElement.paused || !this.currentEpisodeId) return;
      const currentTime = Math.floor(this.videoElement.currentTime);
      const duration = Math.floor(this.videoElement.duration || 0);
      if (currentTime > 0 && duration > 0) {
        this.saveProgress(currentTime, duration);
      }
    }, 15000);
  }

  stopProgressTracking() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * Saves playback progress to backend
   */
  async saveProgress(currentTime, duration) {
    if (!this.currentEpisodeId) return;
    try {
      await api.post('/api/history', {
        episode_id: this.currentEpisodeId,
        progress: currentTime,
        duration: duration
      });
    } catch {
      // Non-critical, ignore transient network failures
    }
  }

  /**
   * Renders in-browser SVG QR code for mobile continuation or watch party sharing
   */
  renderShareQR(targetElement, shareUrl, size = 180) {
    if (!targetElement || !shareUrl) return;
    renderQRCodeToElement(targetElement, shareUrl, size);
  }

  /**
   * Full cleanup lifecycle: detach video, release subtitle worker, clear timers
   */
  destroy() {
    this.stopProgressTracking();

    if (this.videoElement) {
      // Save final progress
      const currentTime = Math.floor(this.videoElement.currentTime || 0);
      const duration = Math.floor(this.videoElement.duration || 0);
      if (currentTime > 5 && duration > 0) {
        this.saveProgress(currentTime, duration);
      }

      this.videoElement.pause();
      this.videoElement.removeAttribute('src');
      this.videoElement.load();
    }

    if (this.subtitlesOctopusInstance && typeof this.subtitlesOctopusInstance.dispose === 'function') {
      try {
        this.subtitlesOctopusInstance.dispose();
      } catch {
        // Suppress cleanup warning
      }
      this.subtitlesOctopusInstance = null;
    }

    this.currentEpisodeId = null;
    this.isMounted = false;
    appState.set('isPlayerActive', false);
    appState.set('currentEpisode', null);
  }
}

export const playerController = new PlayerController();
