/**
 * KuraStream - Watch Party Frontend Engine
 * Real-time group watch synchronization with Server-Sent Events (SSE),
 * fallback polling, drift correction, flying reactions, and live chat.
 */

import { getAuthHeaders } from './auth.js';
import { AuthManager } from '../core/auth.js';
import { iconSvg } from '../core/icons.js';

// Reactions travel as icon keys; older clients sent emoji, which are mapped onto the same icons.
/** Longest stretch a guest extrapolates the host clock (heartbeats arrive every 10 s). */
const MAX_SYNC_EXTRAPOLATION_S = 30;

const REACTION_ICONS = {
  flame: { icon: 'flame', color: '#FF8A4C' },
  heart: { icon: 'heart', color: '#FF6B81' },
  smile: { icon: 'laugh', color: '#F1C75B' },
  sparkles: { icon: 'sparkles', color: '#9AA3FF' },
  'thumbs-up': { icon: 'thumbs-up', color: '#5ED8C6' }
};
const LEGACY_REACTIONS = {
  '\u{1F525}': 'flame',
  '\u2764\uFE0F': 'heart',
  '\u2764': 'heart',
  '\u{1F602}': 'smile',
  '\u{1F923}': 'smile',
  '\u{1F604}': 'smile',
  '\u{1F389}': 'sparkles',
  '\u2728': 'sparkles',
  '\u{1F44D}': 'thumbs-up'
};

class PartyManager {
  constructor() {
    this.activeRoom = null;
    this.clockOffsetMs = 0;
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
    this.refreshTimer = null;
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
    this.soundsMuted = typeof localStorage !== 'undefined' && localStorage.getItem('party_sounds_muted') === 'true';
    this.userBaseRate = 1.0;
    this.sseReconnectTimer = null;
    this.sseRotationTimer = null;
    this.sseFailures = 0;
    this.sseRetryTimer = null;
    // Chat of the current room, kept so a player that starts listening after the join (the join response carries
    // the history, and the player is created later) can still show it.
    this.messageLog = [];
    this.connectionState = 'idle';
  }

  initAudioContext() {
    if (!this.audioContext) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();
      } catch {}
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
    try { localStorage.setItem('party_sounds_muted', this.soundsMuted ? 'true' : 'false'); } catch { /* storage blocked */ }
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
    if (event === 'message' && data) {
      this.messageLog.push(data);
      if (this.messageLog.length > 200) this.messageLog.shift();
    }
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[WatchParty] Listener error for ${event}:`, e); }
      });
    }
  }

  /** 'connecting' | 'live' | 'polling' | 'offline' | 'idle'. Shown in the sync pill instead of a fixed "Sincronizado". */
  setConnectionState(state) {
    if (this.connectionState === state) return;
    this.connectionState = state;
    const pill = typeof document !== 'undefined' ? document.getElementById('party-sync-pill') : null;
    if (pill && state !== 'live' && state !== 'idle') {
      const labels = {
        connecting: ['Conectando...', 'var(--rating-color)'],
        polling: ['Modo respaldo', 'var(--rating-color)'],
        offline: ['Sin conexión', 'var(--danger-color)']
      };
      const [text, color] = labels[state];
      pill.textContent = text;
      pill.style.color = color;
      pill.style.borderColor = color;
    } else if (pill && state === 'live') {
      pill.innerHTML = '<span class="airing-pulse-dot" style="width: 6px; height: 6px; margin-right: 4px;"></span> Sincronizado';
      pill.style.color = 'var(--success-color)';
      pill.style.borderColor = 'var(--success-color)';
    }
    this.emit('connection', state);
  }

  /** The room survives a page reload: the tab remembers it and joins again (the server keeps the member for 60 s). */
  rememberSession(roomId, nickname) {
    try { sessionStorage.setItem('kura_party_session', JSON.stringify({ roomId, nickname })); } catch { /* storage blocked */ }
  }

  forgetSession() {
    try { sessionStorage.removeItem('kura_party_session'); } catch { /* storage blocked */ }
  }

  async restoreSession() {
    if (this.isInRoom()) return null;
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('kura_party_session') || 'null'); } catch { saved = null; }
    if (!saved || !saved.roomId) return null;
    try {
      return await this.joinRoom(saved.roomId, saved.nickname || '');
    } catch {
      this.forgetSession();   // the room is gone (or no longer allows us): do not try again on every reload
      return null;
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
      const user = AuthManager.getUser();
      if (user && user.username) return user.username;

      const profile = AuthManager.getActiveProfile();
      if (profile && profile.name) return profile.name;
    } catch {}

    let guestName = localStorage.getItem('kura_party_nickname');
    if (!guestName) {
      guestName = 'Nakama_' + Math.floor(1000 + Math.random() * 9000);
      localStorage.setItem('kura_party_nickname', guestName);
    }
    return guestName;
  }

  getRandomColor(name) {
    const colors = ['#5ED8C6', '#818CF8', '#3b82f6', '#ec4899', '#f59e0b', '#06b6d4', '#10b981'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  // --- API CALLS ---

  async createRoom({ episodeId, name, isPublic = false, allowGuestControls = false, allowGuests = false }) {
    const username = this.resolveUsername();
    const res = await fetch('/api/party/create', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        episode_id: episodeId,
        name: name || `Sala de ${username}`,
        is_public: isPublic ? 1 : 0,
        allow_guest_controls: allowGuestControls ? 1 : 0,
        allow_guests: allowGuests === true
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
    this.rememberSession(data.room.id, username);
    this.startCapabilityRefreshTimer();
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
    this.rememberSession(data.room.id, username);
    this.startCapabilityRefreshTimer();
    if (data.messages && Array.isArray(data.messages)) {
      data.messages.forEach(msg => {
        this.emit('message', msg);
        if (msg.id > this.lastMessageId) this.lastMessageId = msg.id;
      });
    }

    this.connectEventStream(data.room.id);
    return data.room;
  }

  /** Host only: changes room settings (is_public, allow_guest_controls, allow_guests, name). Resolves with the room. */
  async updateSettings(changes) {
    if (!this.isInRoom() || !this.isHost()) throw new Error('Solo el anfitrión puede cambiar los ajustes');
    const res = await fetch('/api/party/settings', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: this.activeRoom.id,
        member_id: this.memberId,
        member_token: this.memberToken,
        ...changes
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'No se pudieron guardar los ajustes');
    this.activeRoom = { ...this.activeRoom, ...data.room };
    return this.activeRoom;
  }

  async leaveRoom() {
    if (!this.isInRoom()) return;

    const roomId = this.activeRoom.id;
    const username = this.currentUser.username;
    const memberId = this.memberId;
    const memberToken = this.memberToken;

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.disconnectEventStream();
    this.forgetSession();
    this.messageLog = [];
    this.setConnectionState('idle');
    this.activeRoom = null;
    this.currentUser.isHost = false;
    this.memberId = null;
    this.memberToken = null;
    this.streamCapabilityToken = null;

    try {
      await fetch('/api/party/leave', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          room_id: roomId, 
          username,
          member_id: memberId,
          member_token: memberToken
        })
      });
    } catch {}

    this.emit('closed', { reason: 'Has salido de la sala' });
  }

  setupRoomState(room, username, isHost) {
    if (!this.activeRoom || this.activeRoom.id !== room.id) this.messageLog = [];
    this.noteServerClock(room);
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

  // --- REAL-TIME EVENT STREAM (SSE) & CAPABILITY REFRESH ---

  async getSseTicket(roomId) {
    if (!this.memberId || !this.memberToken) return null;
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      headers['X-Party-Member-Id'] = this.memberId;
      headers['X-Party-Member-Token'] = this.memberToken;
      const res = await fetch('/api/party/sse-ticket', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          room_id: roomId,
          member_id: this.memberId,
          member_token: this.memberToken
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.sse_ticket || null;
      }
    } catch {}
    return null;
  }

  startCapabilityRefreshTimer() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    // Refresh capability token every 8 minutes (TTL is 15 minutes)
    this.refreshTimer = setInterval(() => {
      this.refreshCapabilityToken();
    }, 480000);
  }

  async refreshCapabilityToken() {
    if (!this.isInRoom() || !this.memberId || !this.memberToken) return;
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      headers['X-Party-Member-Id'] = this.memberId;
      headers['X-Party-Member-Token'] = this.memberToken;
      const res = await fetch('/api/party/refresh-ticket', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          room_id: this.activeRoom.id,
          member_id: this.memberId,
          member_token: this.memberToken
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.stream_capability_token) {
          this.streamCapabilityToken = data.stream_capability_token;
        }
      }
    } catch (e) {
      console.warn('[WatchParty] Capability ticket refresh error:', e);
    }
  }

  async connectEventStream(roomId) {
    this.disconnectEventStream(false);

    if (!this.isInRoom()) return;
    if (this.connectionState !== 'polling') this.setConnectionState('connecting');

    let sseTicket = null;
    if (this.memberId && this.memberToken) {
      sseTicket = await this.getSseTicket(roomId);
    }

    if (!sseTicket && this.sseFailures >= 2) {
      console.warn('[WatchParty] No se pudo obtener nuevo ticket SSE, pasando a polling de contingencia.');
      this.startPollingFallback(roomId);
      return;
    }

    let streamUrl = `/api/party/stream?room_id=${encodeURIComponent(roomId)}&last_msg_id=${this.lastMessageId}`;
    if (sseTicket) {
      streamUrl += `&sse_ticket=${encodeURIComponent(sseTicket)}`;
    }
    try {
      this.eventSource = new EventSource(streamUrl);

      this.eventSource.onopen = () => {
        this.sseFailures = 0;
        this.stopPollingFallback();
        this.setConnectionState('live');
      };

      this.eventSource.addEventListener('init', (e) => {
        this.sseFailures = 0;
        this.stopPollingFallback();
        this.setConnectionState('live');
        const data = JSON.parse(e.data);
        if (data.room) {
          this.noteServerClock(data.room);
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
          messages.forEach(msg => this.handleIncomingMessage(msg));
        }
      });

      this.eventSource.addEventListener('room_closed', () => {
        this.leaveRoom();
      });

      this.eventSource.onerror = () => {
        // Immediately close dead connection to prevent browser auto-reconnect with stale ticket
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }

        if (!this.isInRoom()) return;

        this.sseFailures++;
        if (this.sseFailures > 3) {
          this.startPollingFallback(roomId);
        } else {
          if (this.connectionState !== 'polling') this.setConnectionState('connecting');
          if (this.sseReconnectTimer) clearTimeout(this.sseReconnectTimer);
          this.sseReconnectTimer = setTimeout(() => {
            this.connectEventStream(roomId);
          }, 1500);
        }
      };

      // Proactive ticket rotation: SSE ticket has 60s TTL. Proactively renew connection at 45s
      if (this.sseRotationTimer) clearTimeout(this.sseRotationTimer);
      this.sseRotationTimer = setTimeout(() => {
        if (this.isInRoom() && this.eventSource) {
          this.connectEventStream(roomId);
        }
      }, 45000);

    } catch (err) {
      console.warn('[WatchParty] SSE connection failed, starting fallback polling:', err);
      this.startPollingFallback(roomId);
    }
  }

  stopPollingFallback() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.sseRetryTimer) {
      clearInterval(this.sseRetryTimer);
      this.sseRetryTimer = null;
    }
  }

  /**
   * Backup channel while the event stream is down: a poll every 1.5 s, but
   *  - nothing while the tab is hidden (nobody is watching, and phones save battery),
   *  - the room being gone/forbidden (401/403/404) ends the session instead of polling forever,
   *  - the event stream is tried again every 30 s, and polling stops as soon as it works.
   */
  startPollingFallback(roomId) {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.setConnectionState('polling');

    if (!this.sseRetryTimer) {
      this.sseRetryTimer = setInterval(() => {
        if (this.isInRoom() && !document.hidden) this.connectEventStream(roomId);
      }, 30000);
    }

    this.pollInterval = setInterval(async () => {
      if (!this.isInRoom()) {
        this.stopPollingFallback();
        return;
      }
      if (document.hidden) return;

      try {
        const headers = { ...getAuthHeaders() };
        if (this.memberId) headers['X-Party-Member-Id'] = this.memberId;
        if (this.memberToken) headers['X-Party-Member-Token'] = this.memberToken;

        const pollUrl = `/api/party/poll?room_id=${encodeURIComponent(roomId)}&last_msg_id=${this.lastMessageId}`;
        const res = await fetch(pollUrl, { headers });
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          // The room was closed, or this member is no longer part of it.
          this.stopPollingFallback();
          this.triggerToastNotification('La sala ya no está disponible');
          await this.leaveRoom();
          return;
        }
        if (!res.ok) {
          this.setConnectionState('offline');
          return;
        }
        this.setConnectionState('polling');
        const data = await res.json();

        if (data.room) {
          this.handleRemoteSync(data.room);
        }
        if (data.messages && Array.isArray(data.messages)) {
          data.messages.forEach(msg => this.handleIncomingMessage(msg));
        }
      } catch {
        this.setConnectionState('offline');
      }
    }, 1500);
  }

  /** A chat/system/reaction message from the stream or the poll: side effects, then the listeners. */
  handleIncomingMessage(msg) {
    if (msg.username && msg.username !== 'Sistema') {
      this.participantsMap.set(msg.username, this.getRandomColor(msg.username));
    }
    if (msg.type === 'reaction') {
      if (msg.username !== this.currentUser.username) this.triggerFlyingReaction(msg.message);
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
  }

  disconnectEventStream(resetFailures = true) {
    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }
    if (this.sseRotationTimer) {
      clearTimeout(this.sseRotationTimer);
      this.sseRotationTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (resetFailures) {
      this.sseFailures = 0;
      this.stopPollingFallback();
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
      const color = String(list[i][1] || 'var(--accent-color)');
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

  /** Server clock minus local clock, learned from every room payload. */
  noteServerClock(room) {
    const serverNow = Number(room && room.server_time_ms);
    if (serverNow > 0) this.clockOffsetMs = serverNow - Date.now();
  }

  /**
   * The host's position right now, in absolute episode seconds: current_time is where the host was
   * at last_sync_timestamp (server clock), so while playing the time since then is added. Measuring
   * that with the local clock threw guests to the end of the episode whenever the two clocks
   * disagreed, so it uses the server offset and never extrapolates past a few heartbeats.
   */
  roomPositionNow(room = this.activeRoom) {
    if (!room) return 0;
    const base = Math.max(0, Number(room.current_time) || 0);
    const syncedAt = Number(room.last_sync_timestamp) || 0;
    if (!room.is_playing || syncedAt <= 0) return base;
    const elapsed = (Date.now() + (this.clockOffsetMs || 0) - syncedAt) / 1000;
    return base + Math.min(Math.max(0, elapsed), MAX_SYNC_EXTRAPOLATION_S);
  }

  handleRemoteSync(newRoom) {
    if (!newRoom) return;
    this.noteServerClock(newRoom);
    if (this.activeRoom && this.activeRoom.is_playing !== newRoom.is_playing) {
      if (newRoom.is_playing) {
        this.triggerToastNotification("El anfitrión ha reanudado el video");
      } else {
        this.triggerToastNotification("El anfitrión ha pausado el video");
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
      this.syncDebounceTimer = null;
      if (!this.activeRoom) return;
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
            // Lets the server drop a heartbeat that predates someone else's seek/pause (see PartyController::syncPlayback)
            base_version: this.activeRoom ? this.activeRoom.version : undefined,
            action
          })
        });
      } catch (err) {
        console.error('[WatchParty] Sync send error:', err);
      }
    }, action ? 0 : 250);
  }

  /**
   * Aligns a guest's <video> with the host.
   * - Room times are ABSOLUTE episode seconds; a remuxed/transcoded stream starts at `offset`,
   *   so the guest's absolute position is offset + video.currentTime.
   * - current_time is the host position at last_sync_timestamp; while playing it must be
   *   extrapolated or every poll/SSE frame drags guests back.
   * - Remuxed streams can't seek in place: `seekAbsolute` restarts the stream at that time.
   */
  applyRemotePlaybackToVideo(video, { offset = 0, isDirect = true, seekAbsolute = null } = {}) {
    if (!video || !this.activeRoom || this.isHost()) return;

    const shouldPlay = Boolean(this.activeRoom.is_playing);
    const targetTime = this.roomPositionNow();
    const clientTime = offset + (video.currentTime || 0);
    const timeDiff = Math.abs(clientTime - targetTime);
    // Restarting FFmpeg costs seconds of buffering; a tight window there causes seek loops.
    const seekThreshold = isDirect ? 2.0 : 5.0;

    this.isApplyingRemoteSync = true;

    const syncPill = document.getElementById('party-sync-pill');
    const baseRate = this.userBaseRate || 1.0;
    // Smooth drift correction algorithm
    if (timeDiff > seekThreshold) {
      // Major jump / seek by host
      if (isDirect || typeof seekAbsolute !== 'function') {
        video.currentTime = Math.max(0, targetTime - offset);
      } else {
        seekAbsolute(targetTime);
      }
    } else if (timeDiff > 0.4 && shouldPlay) {
      if (syncPill) {
        syncPill.innerHTML = `<span class="spinner" style="width: 10px; height: 10px; border-width: 2px; margin-right: 4px;"></span> Alineando...`;
        syncPill.style.color = 'var(--rating-color)';
        syncPill.style.borderColor = 'var(--rating-color)';
      }
      // Settle drift gently without audio glitch
      if (clientTime < targetTime) {
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

  async sendReaction(reaction) {
    if (!this.isInRoom()) return;

    this.triggerFlyingReaction(reaction);

    try {
      await fetch('/api/party/message', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: this.activeRoom.id,
          username: this.currentUser.username,
          member_id: this.memberId,
          member_token: this.memberToken,
          message: reaction,
          type: 'reaction'
        })
      });
    } catch {}
  }

  triggerFlyingReaction(reaction) {
    const container = document.getElementById('player-container');
    if (!container || !document.getElementById('player-view')?.classList.contains('active')) return;
    const key = REACTION_ICONS[reaction] ? reaction : (LEGACY_REACTIONS[String(reaction).trim()] || 'sparkles');
    const { icon, color } = REACTION_ICONS[key];
    const particle = document.createElement('div');
    particle.className = 'party-flying-reaction';
    particle.innerHTML = iconSvg(icon, { size: 34 });
    particle.style.right = `${12 + Math.random() * 22}%`;
    particle.style.setProperty('--drift-x', `${Math.round((Math.random() - 0.5) * 80)}px`);
    particle.style.setProperty('--reaction-size', `${28 + Math.round(Math.random() * 14)}px`);
    particle.style.setProperty('--reaction-color', color);
    container.appendChild(particle);
    setTimeout(() => particle.remove(), 2300);
  }

  triggerToastNotification(message) {
    const toast = document.getElementById('player-toast');
    if (!toast || !document.getElementById('player-view')?.classList.contains('active')) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3000);
  }

  async fetchPublicRooms() {
    try {
      // The list needs a signed-in session (it names hosts and what they are watching).
      const res = await fetch('/api/party/public-rooms', { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      return data.rooms || [];
    } catch {
      return [];
    }
  }
}

export const partyManager = new PartyManager();
