/**
 * KuraStream - Watch Party Frontend Engine
 * Real-time group watch synchronization with Server-Sent Events (SSE),
 * fallback polling, drift correction, flying reactions, and live chat.
 */

import { getAuthHeaders } from './auth.js';

class PartyManager {
  constructor() {
    this.activeRoom = null;
    this.currentUser = {
      username: '',
      isHost: false,
      color: '#00e08f'
    };
    this.memberId = null;
    this.memberToken = null;
    this.streamCapabilityToken = null;
    this.eventSource = null;
    this.pollInterval = null;
    this.lastMessageId = 0;
    this.isApplyingRemoteSync = false;
    this.syncDebounceTimer = null;
    this.listeners = {
      sync: [],
      message: [],
      reaction: [],
      participants: [],
      closed: []
    };
    this.audioContext = null;
    this.soundsMuted = localStorage.getItem('party_sounds_muted') === 'true';
    this.userBaseRate = 1.0;
  }

  initAudioContext() {
    if (!this.audioContext) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();
      } catch (e) {}
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  playMessageChime() {
    if (this.soundsMuted) return;
    this.initAudioContext();
    if (!this.audioContext) return;
    const osc = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    osc.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    osc.type = 'sine';
    const now = this.audioContext.currentTime;
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.06);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playJoinChime() {
    if (this.soundsMuted) return;
    this.initAudioContext();
    if (!this.audioContext) return;
    const osc = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    osc.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    osc.type = 'sine';
    const now = this.audioContext.currentTime;
    osc.frequency.setValueAtTime(330, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.1);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  toggleSounds() {
    this.soundsMuted = !this.soundsMuted;
    localStorage.setItem('party_sounds_muted', this.soundsMuted ? 'true' : 'false');
    const icon = document.getElementById('party-sound-icon');
    if (icon) {
      icon.setAttribute('data-lucide', this.soundsMuted ? 'volume-x' : 'volume-2');
      if (window.lucide) window.lucide.createIcons({ root: icon.parentElement });
    }
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[WatchParty] Listener error for ${event}:`, e); }
      });
    }
  }

  isInRoom() {
    return this.activeRoom !== null && !!this.activeRoom.id;
  }

  isHost() {
    return this.currentUser.isHost;
  }

  canControlPlayback() {
    if (!this.isInRoom()) return true;
    return this.isHost() || !!(this.activeRoom && this.activeRoom.allow_guest_controls);
  }

  resolveUsername() {
    try {
      const user = localStorage.getItem('kura_user');
      if (user) {
        const parsed = JSON.parse(user);
        if (parsed && parsed.username) return parsed.username;
      }
    } catch (e) {}

    let guestName = localStorage.getItem('kura_party_nickname');
    if (!guestName) {
      guestName = 'Nakama_' + Math.floor(1000 + Math.random() * 9000);
      localStorage.setItem('kura_party_nickname', guestName);
    }
    return guestName;
  }

  getRandomColor(name) {
    const colors = ['#00e08f', '#F97316', '#3b82f6', '#ec4899', '#f59e0b', '#06b6d4', '#10b981'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  // --- API CALLS ---

  async createRoom({ episodeId, name, isPublic = false, allowGuestControls = false }) {
    const username = this.resolveUsername();
    const res = await fetch('/api/party/create', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        episode_id: episodeId,
        name: name || `Sala de ${username}`,
        is_public: isPublic ? 1 : 0,
        allow_guest_controls: allowGuestControls ? 1 : 0
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'No se pudo crear la sala');
    }

    this.memberId = data.member_id || null;
    this.memberToken = data.member_token || null;
    this.streamCapabilityToken = data.stream_capability_token || null;

    this.setupRoomState(data.room, username, true);
    this.connectEventStream(data.room.id);
    return data.room;
  }

  async joinRoom(roomId, nickname = '') {
    const username = nickname.trim() || this.resolveUsername();
    localStorage.setItem('kura_party_nickname', username);

    const res = await fetch('/api/party/join', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: roomId,
        username
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'No se pudo conectar a la sala');
    }

    this.memberId = data.member_id || null;
    this.memberToken = data.member_token || null;
    this.streamCapabilityToken = data.stream_capability_token || null;

    this.setupRoomState(data.room, username, data.is_host);
    if (data.messages && Array.isArray(data.messages)) {
      data.messages.forEach(msg => {
        this.emit('message', msg);
        if (msg.id > this.lastMessageId) this.lastMessageId = msg.id;
      });
    }

    this.connectEventStream(data.room.id);
    return data.room;
  }

  async leaveRoom() {
    if (!this.isInRoom()) return;

    const roomId = this.activeRoom.id;
    const username = this.currentUser.username;

    this.disconnectEventStream();
    this.activeRoom = null;
    this.currentUser.isHost = false;
    this.memberId = null;
    this.memberToken = null;
    this.streamCapabilityToken = null;

    try {
      await fetch('/api/party/leave', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId, username })
      });
    } catch (e) {}

    this.emit('closed', { reason: 'Has salido de la sala' });
  }

  setupRoomState(room, username, isHost) {
    this.activeRoom = room;
    this.currentUser = {
      username,
      isHost,
      color: this.getRandomColor(username)
    };
    if (!this.participantsMap) this.participantsMap = new Map();
    this.participantsMap.set(username, this.currentUser.color);
    if (room.host_user) {
      this.participantsMap.set(room.host_user, this.getRandomColor(room.host_user));
    }
    this.renderAvatarStack();
    this.emit('sync', room);
  }

  // --- REAL-TIME EVENT STREAM (SSE) ---

  connectEventStream(roomId) {
    this.disconnectEventStream();

    const streamUrl = `/api/party/stream?room_id=${encodeURIComponent(roomId)}&last_msg_id=${this.lastMessageId}`;
    try {
      this.eventSource = new EventSource(streamUrl);

      this.eventSource.addEventListener('init', (e) => {
        const data = JSON.parse(e.data);
        if (data.room) {
          this.activeRoom = data.room;
          this.emit('sync', data.room);
        }
        if (data.messages && Array.isArray(data.messages)) {
          data.messages.forEach(msg => {
            this.emit('message', msg);
            if (msg.id > this.lastMessageId) this.lastMessageId = msg.id;
          });
        }
      });

      this.eventSource.addEventListener('sync', (e) => {
        const updatedRoom = JSON.parse(e.data);
        this.handleRemoteSync(updatedRoom);
      });

      this.eventSource.addEventListener('messages', (e) => {
        const messages = JSON.parse(e.data);
        if (Array.isArray(messages)) {
          messages.forEach(msg => {
            if (msg.username && msg.username !== 'Sistema') {
              this.participantsMap.set(msg.username, this.getRandomColor(msg.username));
            }
            if (msg.type === 'reaction') {
              this.triggerFlyingReaction(msg.message);
            } else if (msg.type === 'system') {
              this.triggerToastNotification(msg.message);
              const joinMatch = msg.message.match(/(.+) se unió/);
              if (joinMatch) {
                this.participantsMap.set(joinMatch[1], this.getRandomColor(joinMatch[1]));
                if (msg.id > this.lastMessageId) this.playJoinChime();
              }
              const leaveMatch = msg.message.match(/(.+) salió/);
              if (leaveMatch) this.participantsMap.delete(leaveMatch[1]);
            } else {
              if (msg.id > this.lastMessageId && msg.username !== this.currentUser.username) {
                this.playMessageChime();
              }
            }
            this.renderAvatarStack();
            this.emit('message', msg);
            if (msg.id > this.lastMessageId) this.lastMessageId = msg.id;
          });
        }
      });

      this.eventSource.addEventListener('room_closed', () => {
        this.leaveRoom();
      });

      this.eventSource.onerror = () => {
        // Fallback to polling if SSE fails or disconnects
        this.startPollingFallback(roomId);
      };
    } catch (err) {
      console.warn('[WatchParty] SSE connection failed, starting fallback polling:', err);
      this.startPollingFallback(roomId);
    }
  }

  startPollingFallback(roomId) {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      if (!this.isInRoom()) {
        clearInterval(this.pollInterval);
        return;
      }

      try {
        const res = await fetch(`/api/party/poll?room_id=${encodeURIComponent(roomId)}&last_msg_id=${this.lastMessageId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.room) {
          this.handleRemoteSync(data.room);
        }
        if (data.messages && Array.isArray(data.messages)) {
          data.messages.forEach(msg => {
            if (msg.username && msg.username !== 'Sistema') {
              this.participantsMap.set(msg.username, this.getRandomColor(msg.username));
            }
            if (msg.type === 'reaction') {
              this.triggerFlyingReaction(msg.message);
            } else if (msg.type === 'system') {
              this.triggerToastNotification(msg.message);
              const joinMatch = msg.message.match(/(.+) se unió/);
              if (joinMatch) {
                this.participantsMap.set(joinMatch[1], this.getRandomColor(joinMatch[1]));
                if (msg.id > this.lastMessageId) this.playJoinChime();
              }
              const leaveMatch = msg.message.match(/(.+) salió/);
              if (leaveMatch) this.participantsMap.delete(leaveMatch[1]);
            } else {
              if (msg.id > this.lastMessageId && msg.username !== this.currentUser.username) {
                this.playMessageChime();
              }
            }
            this.renderAvatarStack();
            this.emit('message', msg);
            if (msg.id > this.lastMessageId) this.lastMessageId = msg.id;
          });
        }
      } catch (e) {}
    }, 1500);
  }

  disconnectEventStream() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  renderAvatarStack() {
    const container = document.getElementById('party-avatar-stack-container');
    if (!container) return;
    container.innerHTML = '';
    const list = Array.from(this.participantsMap ? this.participantsMap.entries() : []);
    const maxVisible = 3;
    for (let i = 0; i < Math.min(list.length, maxVisible); i++) {
      const username = String(list[i][0] || 'U');
      const color = String(list[i][1] || '#a855f7');
      const initial = username.charAt(0).toUpperCase();

      const avatar = document.createElement('div');
      avatar.className = 'party-stack-avatar';
      avatar.style.background = color;
      avatar.style.zIndex = String(100 - i);
      avatar.title = username;
      avatar.textContent = initial;
      container.appendChild(avatar);
    }
    if (list.length > maxVisible) {
      const countEl = document.createElement('div');
      countEl.className = 'party-stack-count';
      countEl.style.zIndex = '90';
      countEl.textContent = `+${list.length - maxVisible}`;
      container.appendChild(countEl);
    }
  }

  handleRemoteSync(newRoom) {
    if (!newRoom) return;
    if (this.activeRoom && this.activeRoom.is_playing !== newRoom.is_playing) {
      if (newRoom.is_playing) {
        this.triggerToastNotification("▶ El anfitrión ha reanudado el video");
      } else {
        this.triggerToastNotification("⏸ El anfitrión ha pausado el video");
      }
    }
    this.activeRoom = newRoom;
    this.emit('sync', newRoom);
  }

  // --- PLAYBACK SYNC ENGINE ---

  sendPlaybackSync(isPlaying, currentTime, episodeId = null, action = null) {
    if (!this.isInRoom() || !this.canControlPlayback() || this.isApplyingRemoteSync) return;

    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);

    this.syncDebounceTimer = setTimeout(async () => {
      try {
        await fetch('/api/party/sync', {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: this.activeRoom.id,
            username: this.currentUser.username,
            member_id: this.memberId,
            member_token: this.memberToken,
            is_playing: isPlaying ? 1 : 0,
            current_time: currentTime,
            episode_id: episodeId || (this.activeRoom ? this.activeRoom.episode_id : ''),
            action
          })
        });
      } catch (err) {
        console.error('[WatchParty] Sync send error:', err);
      }
    }, action ? 0 : 250);
  }

  applyRemotePlaybackToVideo(video) {
    if (!video || !this.activeRoom || this.isHost()) return;

    const targetTime = Number(this.activeRoom.current_time || 0);
    const shouldPlay = Boolean(this.activeRoom.is_playing);
    const timeDiff = Math.abs(video.currentTime - targetTime);

    this.isApplyingRemoteSync = true;

    const syncPill = document.getElementById('party-sync-pill');
    const baseRate = this.userBaseRate || 1.0;
    // Smooth drift correction algorithm
    if (timeDiff > 2.0) {
      // Major jump / seek by host
      video.currentTime = targetTime;
    } else if (timeDiff > 0.4 && shouldPlay) {
      if (syncPill) {
        syncPill.innerHTML = `<span class="spinner" style="width: 10px; height: 10px; border-width: 2px; margin-right: 4px;"></span> Alineando...`;
        syncPill.style.color = 'var(--rating-color)';
        syncPill.style.borderColor = 'var(--rating-color)';
      }
      // Settle drift gently without audio glitch
      if (video.currentTime < targetTime) {
        video.playbackRate = Math.min(4.0, Number((baseRate * 1.06).toFixed(3)));
      } else {
        video.playbackRate = Math.max(0.25, Number((baseRate * 0.94).toFixed(3)));
      }
    } else {
      if (syncPill) {
        syncPill.innerHTML = `<span class="airing-pulse-dot" style="width: 6px; height: 6px; margin-right: 4px;"></span> Sincronizado`;
        syncPill.style.color = 'var(--success-color)';
        syncPill.style.borderColor = 'var(--success-color)';
      }
      video.playbackRate = baseRate;
    }

    if (shouldPlay && video.paused) {
      video.play().catch(() => {});
    } else if (!shouldPlay && !video.paused) {
      video.pause();
    }

    setTimeout(() => {
      this.isApplyingRemoteSync = false;
    }, 400);
  }

  // --- CHAT & REACTIONS ---

  async sendMessage(text) {
    if (!this.isInRoom() || !text.trim()) return;

    const message = text.trim();
    const res = await fetch('/api/party/message', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: this.activeRoom.id,
        username: this.currentUser.username,
        member_id: this.memberId,
        member_token: this.memberToken,
        message,
        type: 'chat'
      })
    });

    const data = await res.json();
    if (data.success && data.message) {
      this.emit('message', data.message);
      if (data.message.id > this.lastMessageId) this.lastMessageId = data.message.id;
    }
  }

  async sendReaction(emoji) {
    if (!this.isInRoom()) return;

    this.triggerFlyingReaction(emoji);

    try {
      await fetch('/api/party/message', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: this.activeRoom.id,
          username: this.currentUser.username,
          member_id: this.memberId,
          member_token: this.memberToken,
          message: emoji,
          type: 'reaction'
        })
      });
    } catch (e) {}
  }

  triggerFlyingReaction(emoji) {
    const container = document.getElementById('player-container') || document.body;
    const particle = document.createElement('div');
    particle.className = 'party-flying-reaction';
    particle.textContent = emoji;

    const startX = 60 + Math.random() * 30; // 60-90% width
    const driftX = (Math.random() - 0.5) * 60; // random drift

    particle.style.cssText = `
      position: absolute;
      bottom: 80px;
      right: ${100 - startX}%;
      font-size: ${24 + Math.random() * 16}px;
      pointer-events: none;
      z-index: 99999;
      animation: floatUpReaction 2.2s cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
      --drift-x: ${driftX}px;
      filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5));
    `;

    container.appendChild(particle);
    setTimeout(() => {
      if (particle.parentNode) particle.parentNode.removeChild(particle);
    }, 2300);
  }

  triggerToastNotification(message) {
    if (typeof showVideoToast === 'function') {
      showVideoToast(message);
    } else {
      const container = document.getElementById('player-container') || document.body;
      const toast = document.createElement('div');
      toast.style.cssText = `
        position: absolute;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(19, 26, 28, 0.9);
        color: #fff;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 0.9rem;
        z-index: 100000;
        pointer-events: none;
        border: 1px solid rgba(255,255,255,0.1);
        backdrop-filter: blur(8px);
        animation: fadeInDown 0.3s forwards;
      `;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.animation = 'fadeOutUp 0.3s forwards';
        setTimeout(() => { if(toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
      }, 3000);
    }
  }

  async fetchPublicRooms() {
    try {
      const res = await fetch('/api/party/public-rooms');
      const data = await res.json();
      return data.rooms || [];
    } catch (e) {
      return [];
    }
  }
}

export const partyManager = new PartyManager();
