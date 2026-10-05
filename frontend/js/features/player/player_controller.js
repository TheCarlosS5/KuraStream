/**
 * KuraStream v2.0 - Player Feature Controller
 * Encapsulates the video player lifecycle, SubtitlesOctopus / libass worker teardown,
 * progress tracking, and in-browser QR code sharing.
 */


import { appState } from '../../core/state.js';
import { renderQRCodeToElement } from './qr_generator.js';
import { initPlayer, destroyPlayer } from '../../../player.js?v=2026.10.04-credits';

export class PlayerController {
  constructor() {
    this.container = null;
    this.videoElement = null;
    this.currentEpisodeId = null;
    this.isMounted = false;
  }

  /**
   * Mounts the player inside the specified container DOM element.
   */
  mount(container = null, videoElement = null) {
    this.container = container || document.getElementById('player-view');
    this.videoElement = videoElement || (this.container ? this.container.querySelector('video') : null);
    this.isMounted = true;
    appState.set('isPlayerActive', true);
  }

  /**
   * Loads and begins playback for an episode ID
   */
  async loadEpisode(episodeId) {
    if (!episodeId) return null;
    this.currentEpisodeId = episodeId;
    await initPlayer(episodeId);
    return appState.get('currentEpisode');
  }

  /**
   * Full cleanup lifecycle: detach video, release subtitle worker, clear timers
   */
  destroy() {
    destroyPlayer();
    this.currentEpisodeId = null;
    this.isMounted = false;
    appState.set('isPlayerActive', false);
    appState.set('currentEpisode', null);
  }

  /**
   * Renders in-browser SVG QR code for mobile continuation or watch party sharing
   */
  renderShareQR(targetElement, shareUrl, size = 180) {
    if (!targetElement || !shareUrl) return;
    renderQRCodeToElement(targetElement, shareUrl, size);
  }
}

export const playerController = new PlayerController();
