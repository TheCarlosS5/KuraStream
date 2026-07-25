// player.js - Custom VLC-style video player logic with SubtitlesOctopus integration

let video = null;
let container = null;
let controlsOverlay = null;
let playPauseBtn = null;
let centerPlayBtn = null;
let progressCurrent = null;
let progressBuffered = null;
let progressBar = null;
let progressHandle = null;
let timeCurrent = null;
let timeDuration = null;
let muteBtn = null;
let volumeSlider = null;
let speedBtn = null;
let nextEpBtn = null;
let fileInfoBtn = null;
let fileInfoModal = null;
let fileInfoBody = null;
let fileInfoClose = null;
let fullscreenBtn = null;
let skipIntroBtn = null;
let skipOutroBtn = null;
let watchCreditsBtn = null;
let outroOverlayContainer = null;
let countdownOverlay = null;

let isControlsVisible = true;
let hideControlsTimeout = null;
let isDraggingProgress = false;
let currentEpisodeId = null;
let currentEpisodeData = null;
let currentShowData = null;
let nextEpisodeId = null;
let selectedAudioTrackNum = 0;
let selectedSubtitleTrackNum = -1; // -1 = Off
let currentStreamStartOffset = 0;
let outroDismissed = false;

// SubtitlesOctopus Instance
let octopusInstance = null;

// Progress Save Interval
let progressSaveInterval = null;
let lastSavedTime = 0;

// Active state tracker for keyboard inputs
let isPlayerActive = false;

export async function initPlayer(episodeId) {
  currentEpisodeId = episodeId;
  selectedAudioTrackNum = 0;
  selectedSubtitleTrackNum = -1;
  isPlayerActive = true;
  
  // Cache DOM elements
  video = document.getElementById('video-element');
  container = document.getElementById('player-container');
  controlsOverlay = document.getElementById('player-controls-overlay');
  playPauseBtn = document.getElementById('play-pause-btn');
  centerPlayBtn = document.getElementById('center-play-pause-btn');
  progressCurrent = document.getElementById('player-progress-current');
  progressBuffered = document.getElementById('player-progress-buffered');
  progressBar = document.getElementById('player-progress-bar');
  progressHandle = document.getElementById('player-progress-handle');
  timeCurrent = document.getElementById('player-time-current');
  timeDuration = document.getElementById('player-time-duration');
  muteBtn = document.getElementById('mute-btn');
  volumeSlider = document.getElementById('volume-slider');
  speedBtn = document.getElementById('speed-btn');
  nextEpBtn = document.getElementById('next-ep-btn');
  fileInfoBtn = document.getElementById('file-info-btn');
  fileInfoModal = document.getElementById('file-info-modal');
  fileInfoBody = document.getElementById('file-info-body');
  fileInfoClose = document.getElementById('file-info-close');
  fullscreenBtn = document.getElementById('fullscreen-btn');
  skipIntroBtn = document.getElementById('skip-intro-btn');
  skipOutroBtn = document.getElementById('skip-outro-btn');
  watchCreditsBtn = document.getElementById('watch-credits-btn');
  outroOverlayContainer = document.getElementById('outro-overlay-container');
  countdownOverlay = document.getElementById('autoplay-countdown-overlay');
  
  outroDismissed = false;

  // Load episode metadata
  try {
    const res = await fetch(`/api/shows/${episodeId.split('_S')[0]}`);
    const data = await res.json();
    currentShowData = data.show;
    
    currentEpisodeData = data.episodes.find(e => e.id === episodeId);
    if (!currentEpisodeData) throw new Error('Episode not found');
    
    // Check if next episode exists
    const nextEp = data.episodes.find(e => 
      e.season_number === currentEpisodeData.season_number && 
      e.episode_number === currentEpisodeData.episode_number + 1
    );
    nextEpisodeId = nextEp ? nextEp.id : null;
    
    document.getElementById('player-show-title').textContent = currentShowData.title;
    document.getElementById('player-episode-title').textContent = `${currentEpisodeData.season_number ? `Temporada ${currentEpisodeData.season_number} • ` : ''}Capítulo ${currentEpisodeData.episode_number}: ${currentEpisodeData.title}`;
  } catch (e) {
    console.error(e);
    alert('Error al cargar datos del reproductor');
    location.hash = '#/';
    return;
  }

  // Resolve Audio and Subtitle track preferences from Settings
  const prefAudio = localStorage.getItem('kura_pref_audio_lang') || 'default';
  const prefSub = localStorage.getItem('kura_pref_sub_lang') || 'default';

  // 1. Resolve Audio Track
  const audioTracks = JSON.parse(currentEpisodeData.audio_tracks || '[]');
  let chosenAudio = 0; // Default fallback to first track
  if (prefAudio !== 'default' && audioTracks.length > 0) {
    const match = audioTracks.find(t => (t.language || '').toLowerCase().includes(prefAudio.toLowerCase()));
    if (match) {
      chosenAudio = match.track_number;
    }
  }
  selectedAudioTrackNum = chosenAudio;

  // 2. Resolve Subtitle Track
  const subTracks = JSON.parse(currentEpisodeData.subtitle_tracks || '[]');
  let chosenSub = -1; // Default fallback to Off
  if (prefSub === 'off') {
    chosenSub = -1;
  } else if (prefSub !== 'default' && subTracks.length > 0) {
    const match = subTracks.find(t => (t.language || '').toLowerCase().includes(prefSub.toLowerCase()));
    if (match) {
      chosenSub = match.track_number;
    } else {
      chosenSub = subTracks[0].track_number; // "si nop hay español tonce el subtitulo que traiga"
    }
  } else if (prefSub === 'default' && subTracks.length > 0) {
    chosenSub = subTracks[0].track_number; // Default select first
  }
  selectedSubtitleTrackNum = chosenSub;

  // Set up menus for Audio and Subtitles
  setupTracksMenu();

  // Load progress from backend
  let startProgress = 0;
  try {
    let activeUser = 'guest';
    const sessionStr = localStorage.getItem('kura_user_session');
    if (sessionStr) {
      try { activeUser = JSON.parse(sessionStr).username; } catch(e) {}
    }
    const progressRes = await fetch(`/api/progress/${episodeId}?username=${encodeURIComponent(activeUser)}`);
    const progressData = await progressRes.json();
    startProgress = progressData.progress || 0;
  } catch (e) {
    console.warn("Could not load watch progress:", e);
  }

  // Load video source
  loadVideoStream(startProgress);

  // Set up event listeners
  setupPlayerEventListeners();

  // Reset controls timer
  triggerControlsActivity();
  
  // Volume restore
  const savedVolume = localStorage.getItem('playerVolume');
  if (savedVolume !== null) {
    video.volume = parseFloat(savedVolume);
    volumeSlider.value = savedVolume;
    updateVolumeIcon(video.volume);
  }

  // Playback speed restore
  const savedSpeed = localStorage.getItem('kura_playback_speed') || '1';
  const speedBtnEl = document.getElementById('speed-btn');
  if (speedBtnEl) {
    speedBtnEl.textContent = `${savedSpeed}x`;
    document.querySelectorAll('.speed-opt').forEach(o => {
      if (o.getAttribute('data-speed') === savedSpeed) {
        o.classList.add('active');
      } else {
        o.classList.remove('active');
      }
    });
  }

  // Watch progress saving interval (every 10 seconds)
  progressSaveInterval = setInterval(() => {
    saveWatchProgress();
  }, 10000);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function loadVideoStream(startTime = 0) {
  currentStreamStartOffset = startTime;
  destroySubtitles();
  
  // Build Stream URL
  let streamUrl = `/api/stream/${currentEpisodeId}?audio=${selectedAudioTrackNum}`;
  if (startTime > 0) {
    streamUrl += `&start=${startTime}`;
  }
  
  video.src = streamUrl;
  video.load();
  
  // Set playback speed state
  const currentSpeed = parseFloat(speedBtn.textContent) || 1.0;
  video.playbackRate = currentSpeed;

  video.play().catch(e => {
    // Autoplay block fallback
    const playIcon = document.getElementById('play-icon');
    const centerPlayIcon = document.getElementById('center-play-icon');
    if (playIcon) playIcon.setAttribute('data-lucide', 'play');
    if (centerPlayIcon) centerPlayIcon.setAttribute('data-lucide', 'play');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    centerPlayBtn.style.display = 'flex';
  });

  // Reinitialize Subtitles if selected
  if (selectedSubtitleTrackNum !== -1) {
    initSubtitles(selectedSubtitleTrackNum);
  }
}

function saveWatchProgress() {
  if (!video || video.paused || video.ended) return;
  
  // If we seeked, we need to add the offset of the current seek start time
  const currentStreamSrc = video.src;
  const parsedUrl = new URL(currentStreamSrc, window.location.origin);
  const startOffset = parseFloat(parsedUrl.searchParams.get('start') || 0);
  const totalWatched = startOffset + video.currentTime;
  
  // Only save if progress moved significantly
  if (Math.abs(totalWatched - lastSavedTime) > 3) {
    lastSavedTime = totalWatched;
    let activeUser = 'guest';
    const sessionStr = localStorage.getItem('kura_user_session');
    if (sessionStr) {
      try { activeUser = JSON.parse(sessionStr).username; } catch(e) {}
    }
    fetch(`/api/progress/${currentEpisodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: totalWatched, username: activeUser })
    });
  }
}

// SubtitlesOctopus WASM Renderer
function initSubtitles(trackNum) {
  destroySubtitles();
  
  if (trackNum === -1) return;
  
  // SubtitlesOctopus library must be loaded in the page
  if (typeof SubtitlesOctopus === 'undefined') {
    // If not loaded yet, inject worker script
    const script = document.createElement('script');
    script.src = '/vendor/subtitles-octopus/subtitles-octopus.js';
    script.onload = () => {
      startOctopusInstance(trackNum);
    };
    document.body.appendChild(script);
  } else {
    startOctopusInstance(trackNum);
  }
}

function startOctopusInstance(trackNum) {
  // If the video hasn't loaded metadata yet (dimensions are 0), delay initialization
  if (!video.videoWidth || !video.videoHeight) {
    console.log("Video metadata not loaded yet. Delaying SubtitlesOctopus initialization...");
    video.addEventListener('loadedmetadata', () => {
      startOctopusInstance(trackNum);
    }, { once: true });
    return;
  }

  try {
    console.log(`Initializing SubtitlesOctopus with video dimensions: ${video.videoWidth}x${video.videoHeight}`);
    octopusInstance = new SubtitlesOctopus({
      video: video,
      subUrl: `/api/subtitle/${currentEpisodeId}/${trackNum}`,
      workerUrl: '/vendor/subtitles-octopus/subtitles-octopus-worker.js',
      legacyWorkerUrl: '/vendor/subtitles-octopus/subtitles-octopus-worker-legacy.js',
      fallbackFont: '/vendor/subtitles-octopus/default.ttf', // default fallback font
      timeOffset: currentStreamStartOffset,
      container: document.getElementById('subtitles-container')
    });
  } catch (err) {
    console.error('Failed to launch SubtitlesOctopus WASM worker:', err);
  }
}

function destroySubtitles() {
  if (octopusInstance) {
    try {
      octopusInstance.dispose();
    } catch (e) {
      console.warn('Error disposing subtitles:', e);
    }
    octopusInstance = null;
  }
}

export function destroyPlayer() {
  isPlayerActive = false;
  currentStreamStartOffset = 0;
  // Save progress before destroying
  saveWatchProgress();

  if (progressSaveInterval) {
    clearInterval(progressSaveInterval);
    progressSaveInterval = null;
  }

  destroySubtitles();

  if (video) {
    video.pause();
    video.ontimeupdate = null;
    video.onprogress = null;
    video.onended = null;
    video.onplay = null;
    video.onpause = null;
    video.onloadedmetadata = null;
    video.removeAttribute('src');
    video.load();
    video = null;
  }

  if (container) {
    container.onmousemove = null;
    container.onmouseleave = null;
  }

  // Hide overlays
  if (countdownOverlay) countdownOverlay.style.display = 'none';
  if (fileInfoModal) fileInfoModal.style.display = 'none';
}

function setupTracksMenu() {
  const audioMenu = document.getElementById('audio-menu-list');
  const subMenu = document.getElementById('subtitle-menu-list');
  
  const audioTracks = JSON.parse(currentEpisodeData.audio_tracks || '[]');
  const subTracks = JSON.parse(currentEpisodeData.subtitle_tracks || '[]');

  // Setup Audio Track menu
  if (audioTracks.length === 0) {
    audioMenu.innerHTML = `<button class="active">Audio por defecto</button>`;
  } else {
    audioMenu.innerHTML = audioTracks.map(t => {
      const activeClass = t.track_number === selectedAudioTrackNum ? 'class="active"' : '';
      const name = `${t.track_number + 1}. ${t.title} (${t.language.toUpperCase()}) - ${t.codec.toUpperCase()} ${t.channels === 2 ? 'Estéreo' : t.channels + 'ch'}`;
      return `<button ${activeClass} data-track="${t.track_number}">${name}</button>`;
    }).join('');

    // Bind Audio Track selection
    audioMenu.querySelectorAll('button').forEach(btn => {
      btn.onclick = (e) => {
        audioMenu.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        selectedAudioTrackNum = parseInt(e.target.getAttribute('data-track'), 10);
        
        // Reload stream from current position with new audio track
        const currentStreamSrc = video.src;
        const parsedUrl = new URL(currentStreamSrc, window.location.origin);
        const startOffset = parseFloat(parsedUrl.searchParams.get('start') || 0);
        const currentPos = startOffset + video.currentTime;
        
        loadVideoStream(currentPos);
      };
    });
  }

  // Setup Subtitle Track menu
  const subOffActive = selectedSubtitleTrackNum === -1 ? 'class="active"' : '';
  let subMenuHtml = `<button ${subOffActive} data-track="-1">Desactivados</button>`;
  
  if (subTracks.length > 0) {
    subMenuHtml += subTracks.map(t => {
      const activeClass = t.track_number === selectedSubtitleTrackNum ? 'class="active"' : '';
      const name = `${t.track_number + 1}. ${t.title} (${t.language.toUpperCase()}) - ${t.codec.toUpperCase()}`;
      return `<button ${activeClass} data-track="${t.track_number}">${name}</button>`;
    }).join('');
  }
  
  subMenu.innerHTML = subMenuHtml;

  // Bind Subtitle selection
  subMenu.querySelectorAll('button').forEach(btn => {
    btn.onclick = (e) => {
      subMenu.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      selectedSubtitleTrackNum = parseInt(e.target.getAttribute('data-track'), 10);
      
      initSubtitles(selectedSubtitleTrackNum);
    };
  });
}

function setupPlayerEventListeners() {
  // Play/Pause toggling
  const togglePlay = () => {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
    triggerControlsActivity();
  };

  video.onplay = () => {
    const playIcon = document.getElementById('play-icon');
    const centerPlayIcon = document.getElementById('center-play-icon');
    if (playIcon) playIcon.setAttribute('data-lucide', 'pause');
    if (centerPlayIcon) centerPlayIcon.setAttribute('data-lucide', 'pause');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    // Fade out center button quickly
    setTimeout(() => {
      if (!video.paused) centerPlayBtn.style.display = 'none';
    }, 500);
  };

  video.onloadedmetadata = () => {
    if (speedBtn) {
      const currentSpeed = parseFloat(speedBtn.textContent) || 1.0;
      video.playbackRate = currentSpeed;
    }
  };

  video.onpause = () => {
    const playIcon = document.getElementById('play-icon');
    const centerPlayIcon = document.getElementById('center-play-icon');
    if (playIcon) playIcon.setAttribute('data-lucide', 'play');
    if (centerPlayIcon) centerPlayIcon.setAttribute('data-lucide', 'play');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    centerPlayBtn.style.display = 'flex';
    saveWatchProgress();
  };

  playPauseBtn.onclick = togglePlay;
  centerPlayBtn.onclick = togglePlay;
  
  // Click on video canvas to toggle play
  video.onclick = (e) => {
    // Ignore click if clicking info panels or dropdowns
    if (e.target.tagName === 'VIDEO') {
      togglePlay();
    }
  };

  // Keyboard controls
  const handleKeyboard = (e) => {
    if (!isPlayerActive) return;
    
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight') {
      // Seek forward 10 seconds
      seekRelative(10);
    } else if (e.code === 'ArrowLeft') {
      // Seek backward 10 seconds
      seekRelative(-10);
    } else if (e.code === 'ArrowUp') {
      // Volume up
      e.preventDefault();
      video.volume = Math.min(1, video.volume + 0.1);
      volumeSlider.value = video.volume;
      updateVolumeIcon(video.volume);
    } else if (e.code === 'ArrowDown') {
      // Volume down
      e.preventDefault();
      video.volume = Math.max(0, video.volume - 0.1);
      volumeSlider.value = video.volume;
      updateVolumeIcon(video.volume);
    } else if (e.code === 'KeyF') {
      // Toggle fullscreen
      toggleFullscreen();
    } else if (e.code === 'Escape') {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        location.hash = `#/show/${currentEpisodeId.split('_S')[0]}`;
      }
    }
  };
  
  document.removeEventListener('keydown', handleKeyboard);
  document.addEventListener('keydown', handleKeyboard);

  // Time Updates & Progress scrubber
  video.ontimeupdate = () => {
    if (!video || isDraggingProgress) return;
    
    const currentStreamSrc = video.src;
    const parsedUrl = new URL(currentStreamSrc, window.location.origin);
    const startOffset = parseFloat(parsedUrl.searchParams.get('start') || 0);
    
    const totalCurrentTime = startOffset + video.currentTime;
    
    // Duration is taken from ffprobe (more reliable than browser during copy streams)
    const duration = currentEpisodeData.duration || video.duration || 1;

    timeCurrent.textContent = formatTime(totalCurrentTime);
    timeDuration.textContent = formatTime(duration);

    const progressPercent = (totalCurrentTime / duration) * 100;
    progressCurrent.style.width = `${progressPercent}%`;
    progressHandle.style.left = `${progressPercent}%`;

    // Intro skipper overlay logic
    const introStart = currentEpisodeData.intro_start;
    const introEnd = currentEpisodeData.intro_end;
    
    if (introStart !== null && introStart !== undefined && totalCurrentTime >= introStart && totalCurrentTime < (introEnd || (introStart + 90))) {
      skipIntroBtn.style.display = 'block';
    } else {
      skipIntroBtn.style.display = 'none';
    }

    // Outro skipper overlay logic (Next Episode and Credits container)
    const outroStart = currentEpisodeData.outro_start;
    if (nextEpisodeId && outroStart !== null && outroStart !== undefined && totalCurrentTime >= outroStart && !outroDismissed) {
      outroOverlayContainer.style.display = 'flex';
    } else {
      outroOverlayContainer.style.display = 'none';
    }
  };

  // Buffer range updates
  video.onprogress = () => {
    if (!video) return;
    if (video.buffered.length > 0) {
      const currentStreamSrc = video.src;
      const parsedUrl = new URL(currentStreamSrc, window.location.origin);
      const startOffset = parseFloat(parsedUrl.searchParams.get('start') || 0);
      const duration = currentEpisodeData.duration || video.duration || 1;
      
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const totalBuffered = startOffset + bufferedEnd;
      
      const bufferedPercent = (totalBuffered / duration) * 100;
      progressBuffered.style.width = `${bufferedPercent}%`;
    }
  };

  // Video Ending Logic (Countdown)
  video.onended = () => {
    if (!video) return;
    saveWatchProgress();
    if (nextEpisodeId) {
      triggerCountdownAutoplay();
    } else {
      // Return to detail view
      location.hash = `#/show/${currentEpisodeId.split('_S')[0]}`;
    }
  };

  // Scrubbing Timeline event listeners
  const getTimelineClickPos = (e) => {
    const rect = progressBar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, pos));
  };

  progressBar.onmousedown = (e) => {
    isDraggingProgress = true;
    updateProgressOnDrag(e);
  };

  window.onmousemove = (e) => {
    if (isDraggingProgress) {
      updateProgressOnDrag(e);
    }
  };

  window.onmouseup = () => {
    if (isDraggingProgress) {
      isDraggingProgress = false;
      
      const percent = parseFloat(progressCurrent.style.width) / 100;
      const duration = currentEpisodeData.duration || video.duration || 1;
      const targetTime = percent * duration;
      
      // Perform seek by reloading the video stream starting at this time!
      loadVideoStream(targetTime);
    }
  };

  function updateProgressOnDrag(e) {
    const pos = getTimelineClickPos(e);
    progressCurrent.style.width = `${pos * 100}%`;
    progressHandle.style.left = `${pos * 100}%`;
    
    const duration = currentEpisodeData.duration || video.duration || 1;
    timeCurrent.textContent = formatTime(pos * duration);
  }

  // Volume slider control
  volumeSlider.oninput = (e) => {
    const vol = parseFloat(e.target.value);
    video.volume = vol;
    video.muted = vol === 0;
    updateVolumeIcon(vol);
    localStorage.setItem('playerVolume', vol);
    triggerControlsActivity();
  };

  muteBtn.onclick = () => {
    if (video.muted) {
      video.muted = false;
      const vol = parseFloat(volumeSlider.value) || 1.0;
      video.volume = vol;
      updateVolumeIcon(vol);
    } else {
      video.muted = true;
      updateVolumeIcon(0);
    }
    triggerControlsActivity();
  };

  // Playback Speed Selector options
  document.querySelectorAll('.speed-opt').forEach(opt => {
    opt.onclick = (e) => {
      document.querySelectorAll('.speed-opt').forEach(o => o.classList.remove('active'));
      e.target.classList.add('active');
      const rate = parseFloat(e.target.getAttribute('data-speed'));
      video.playbackRate = rate;
      speedBtn.textContent = `${rate}x`;
      // Close dropdown
      document.getElementById('speed-dropdown').classList.remove('active');
    };
  });

  // Next Episode button
  if (nextEpisodeId) {
    nextEpBtn.style.display = 'flex';
    nextEpBtn.onclick = () => {
      location.hash = `#/player/${nextEpisodeId}`;
    };
  } else {
    nextEpBtn.style.display = 'none';
  }

  // Fullscreen controller
  fullscreenBtn.onclick = toggleFullscreen;

  // Technical file info overlay modal toggles
  fileInfoBtn.onclick = () => {
    if (fileInfoModal.style.display === 'none') {
      showTechnicalModal();
    } else {
      fileInfoModal.style.display = 'none';
    }
    triggerControlsActivity();
  };

  fileInfoClose.onclick = () => {
    fileInfoModal.style.display = 'none';
  };

  // Skip Intro button listener
  skipIntroBtn.onclick = () => {
    const introEnd = currentEpisodeData.intro_end;
    if (introEnd !== null && introEnd !== undefined) {
      const startOffset = parseFloat(new URL(video.src, window.location.origin).searchParams.get('start') || 0);
      video.currentTime = introEnd - startOffset;
    } else {
      seekRelative(90);
    }
    skipIntroBtn.style.display = 'none';
  };

  // Skip Outro button listener (Siguiente Capítulo)
  skipOutroBtn.onclick = () => {
    outroOverlayContainer.style.display = 'none';
    if (nextEpisodeId) {
      location.hash = `#/player/${nextEpisodeId}`;
    }
  };

  // Watch Credits button listener (Ver Créditos)
  watchCreditsBtn.onclick = () => {
    outroDismissed = true;
    outroOverlayContainer.style.display = 'none';
  };

  // Dropdown menus triggers click handler
  document.querySelectorAll('.dropdown-trigger').forEach(trigger => {
    trigger.onclick = (e) => {
      e.stopPropagation();
      const parent = trigger.parentElement;
      const isActive = parent.classList.contains('active');
      
      // Close all dropdowns
      document.querySelectorAll('.player-dropdown').forEach(d => d.classList.remove('active'));
      
      if (!isActive) {
        parent.classList.add('active');
      }
      triggerControlsActivity();
    };
  });

  // Close menus on click outside
  window.onclick = () => {
    document.querySelectorAll('.player-dropdown').forEach(d => d.classList.remove('active'));
  };

  // Exit button
  document.getElementById('player-back-btn').onclick = () => {
    location.hash = `#/show/${currentEpisodeId.split('_S')[0]}`;
  };

  // Mouse activity tracker for controls fading
  container.onmousemove = () => {
    if (!video) return;
    triggerControlsActivity();
  };

  container.onmouseleave = () => {
    if (!video) return;
    if (!video.paused) {
      controlsOverlay.classList.add('hide');
    }
  };
}

function seekRelative(seconds) {
  const currentStreamSrc = video.src;
  const parsedUrl = new URL(currentStreamSrc, window.location.origin);
  const startOffset = parseFloat(parsedUrl.searchParams.get('start') || 0);
  const totalCurrentTime = startOffset + video.currentTime;
  
  const duration = currentEpisodeData.duration || video.duration || 1;
  const targetTime = Math.max(0, Math.min(duration, totalCurrentTime + seconds));
  
  loadVideoStream(targetTime);
}

function toggleFullscreen() {
  const fsIcon = document.getElementById('fullscreen-icon');
  if (!document.fullscreenElement) {
    container.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable full-screen mode: ${err.message}`);
    });
    if (fsIcon) fsIcon.setAttribute('data-lucide', 'minimize');
  } else {
    document.exitFullscreen();
    if (fsIcon) fsIcon.setAttribute('data-lucide', 'maximize');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateVolumeIcon(vol) {
  const volIcon = document.getElementById('volume-icon');
  if (!volIcon) return;
  let iconName = 'volume-2';
  if (vol === 0 || video.muted) {
    iconName = 'volume-x';
  } else if (vol < 0.5) {
    iconName = 'volume-1';
  }
  volIcon.setAttribute('data-lucide', iconName);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showTechnicalModal() {
  const ep = currentEpisodeData;
  const sizeGb = (ep.size / (1024 * 1024 * 1024)).toFixed(2);
  
  fileInfoBody.innerHTML = `
    <div class="info-item">
      <span class="info-label">Resolución</span>
      <span class="info-val">${ep.resolution || 'N/A'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Formato de Video</span>
      <span class="info-val">${ep.video_codec || 'N/A'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">FPS (Tasa de frames)</span>
      <span class="info-val">${ep.fps ? ep.fps.toFixed(3) : 'N/A'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Tamaño del archivo</span>
      <span class="info-val">${sizeGb} GB</span>
    </div>
    <div class="info-item">
      <span class="info-label">Duración total</span>
      <span class="info-val">${formatTime(ep.duration)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Ruta local de origen</span>
      <span class="info-val" style="font-size: 0.7rem; max-width: 60%;">${ep.filepath}</span>
    </div>
  `;
  fileInfoModal.style.display = 'block';
}

function triggerControlsActivity() {
  controlsOverlay.classList.remove('hide');
  isControlsVisible = true;
  document.body.style.cursor = 'default';
  
  clearTimeout(hideControlsTimeout);
  
  // Hide after 3 seconds of inactivity if playing
  if (video && !video.paused) {
    hideControlsTimeout = setTimeout(() => {
      controlsOverlay.classList.add('hide');
      isControlsVisible = false;
      document.body.style.cursor = 'none';
      // Close open dropdowns
      document.querySelectorAll('.player-dropdown').forEach(d => d.classList.remove('active'));
      fileInfoModal.style.display = 'none';
    }, 3000);
  }
}

function triggerCountdownAutoplay() {
  countdownOverlay.style.display = 'flex';
  const countdownNumber = document.getElementById('countdown-number');
  const cancelBtn = document.getElementById('countdown-cancel');
  const playNowBtn = document.getElementById('countdown-play-now');
  const nextTitleText = document.getElementById('countdown-next-title');

  // Load next episode details
  nextTitleText.textContent = `Cargando siguiente capítulo...`;
  
  // Retrieve title of the next episode
  fetch(`/api/shows/${currentEpisodeId.split('_S')[0]}`).then(res => res.json()).then(data => {
    const nextEp = data.episodes.find(e => e.id === nextEpisodeId);
    if (nextEp) {
      nextTitleText.textContent = `Capítulo ${nextEp.episode_number}: ${nextEp.title}`;
    }
  });

  let secondsLeft = 5;
  countdownNumber.textContent = secondsLeft;
  
  const timer = setInterval(() => {
    secondsLeft--;
    countdownNumber.textContent = secondsLeft;
    if (secondsLeft <= 0) {
      clearInterval(timer);
      countdownOverlay.style.display = 'none';
      location.hash = `#/player/${nextEpisodeId}`;
    }
  }, 1000);

  playNowBtn.onclick = () => {
    clearInterval(timer);
    countdownOverlay.style.display = 'none';
    location.hash = `#/player/${nextEpisodeId}`;
  };

  cancelBtn.onclick = () => {
    clearInterval(timer);
    countdownOverlay.style.display = 'none';
    // Just stay on player, video is paused
  };
}

// Time Formatting Helpers
function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
