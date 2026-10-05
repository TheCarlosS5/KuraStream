// Load test for ~30 simultaneous viewers on a LAN (k6: https://k6.io).
//
//   k6 run -e BASE_URL=http://192.168.1.50:3000 -e USERS=30 tests/load/k6_30_users.js
//
// What 30 people do at once: log in, browse the catalogue, stream by byte ranges (direct play), ten of them sit in
// Watch Party rooms (SSE), and a few start a remux/transcode. The thresholds are the goals of Phase 1:
// API requests answer in under 1 s (p95 of the catalogue under 300 ms) while all of that runs.
//
// The test registers throw-away accounts (load_<run>_<n>); with REGISTRATION limits per address you may need
// REGISTER_MAX_PER_HOUR=1000 on the server under test, or pass accounts with -e ACCOUNTS='user1:pass1,user2:pass2'.
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const USERS = parseInt(__ENV.USERS || '30', 10);
const DURATION = __ENV.DURATION || '3m';
const RUN = `${Date.now().toString(36)}`;

const catalogue = new Trend('kura_catalogue_ms', true);
const rangeReq = new Trend('kura_range_ms', true);
const busy = new Counter('kura_transcode_busy');

export const options = {
  scenarios: {
    browsers: { executor: 'constant-vus', vus: Math.max(1, USERS - 14), duration: DURATION, exec: 'browse' },
    partyroom: { executor: 'constant-vus', vus: 10, duration: DURATION, exec: 'party' },
    remuxers: { executor: 'constant-vus', vus: 4, duration: DURATION, exec: 'remux' },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{kind:api}': ['p(95)<1000'],
    kura_catalogue_ms: ['p(95)<300'],
    kura_range_ms: ['p(95)<1500'],
  },
};

function json(res) { try { return res.json(); } catch { return null; } }

function login(n) {
  const accounts = (__ENV.ACCOUNTS || '').split(',').filter(Boolean);
  if (accounts.length) {
    const [username, password] = accounts[n % accounts.length].split(':');
    const res = http.post(`${BASE}/api/login`, JSON.stringify({ username, password }), { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'api' } });
    return json(res);
  }
  const username = `load_${RUN}_${n}`;
  const password = 'LoadTest!2026';
  http.post(`${BASE}/api/register`, JSON.stringify({ username, password }), { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'api' } });
  return json(http.post(`${BASE}/api/login`, JSON.stringify({ username, password }), { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'api' } }));
}

function session(n) {
  const data = login(n);
  if (!data || !data.token) return null;
  const headers = { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' };
  // pick the first profile
  const profiles = json(http.get(`${BASE}/api/profiles`, { headers, tags: { kind: 'api' } }));
  const list = Array.isArray(profiles) ? profiles : (profiles && profiles.profiles) || [];
  if (list.length) {
    const sel = json(http.post(`${BASE}/api/profiles/select`, JSON.stringify({ profile_id: list[0].id }), { headers, tags: { kind: 'api' } }));
    if (sel && sel.token) headers.Authorization = `Bearer ${sel.token}`;
  }
  return headers;
}

function firstEpisode(headers) {
  const shows = json(http.get(`${BASE}/api/shows?limit=20`, { headers, tags: { kind: 'api' } })) || [];
  for (const show of shows) {
    const detail = json(http.get(`${BASE}/api/shows/${encodeURIComponent(show.id)}`, { headers, tags: { kind: 'api' } }));
    if (detail && detail.episodes && detail.episodes.length) return detail.episodes[0];
  }
  return null;
}

export function browse() {
  const headers = session(__VU);
  if (!headers) { sleep(5); return; }
  const episode = firstEpisode(headers);
  for (let i = 0; i < 20; i++) {
    group('catalogue', () => {
      const res = http.get(`${BASE}/api/shows`, { headers, tags: { kind: 'api' } });
      catalogue.add(res.timings.duration);
      check(res, { 'catalogue 200': (r) => r.status === 200 });
      http.get(`${BASE}/api/history/continue`, { headers, tags: { kind: 'api' } });
    });
    if (episode) {
      group('direct play ranges', () => {
        let start = Math.floor(Math.random() * 50) * 1024 * 1024;
        for (let k = 0; k < 4; k++) {
          const res = http.get(`${BASE}/api/stream/${encodeURIComponent(episode.id)}`, { headers: { ...headers, Range: `bytes=${start}-${start + 2 * 1024 * 1024 - 1}` }, tags: { kind: 'stream' } });
          rangeReq.add(res.timings.duration);
          check(res, { 'range 206/200/503': (r) => [200, 206, 503].includes(r.status) });
          start += 2 * 1024 * 1024;
          sleep(0.5);
        }
      });
      http.post(`${BASE}/api/progress/${encodeURIComponent(episode.id)}`, JSON.stringify({ progress: 60, duration: 1400, client_ts: Date.now() }), { headers, tags: { kind: 'api' } });
    }
    sleep(2 + Math.random() * 3);
  }
}

export function party() {
  const headers = session(100 + __VU);
  if (!headers) { sleep(5); return; }
  const episode = firstEpisode(headers);
  if (!episode) { sleep(10); return; }
  const created = json(http.post(`${BASE}/api/party/create`, JSON.stringify({ episode_id: episode.id, name: `load ${RUN} ${__VU}`, allow_guests: false }), { headers, tags: { kind: 'api' } }));
  if (!created || !created.success) { sleep(10); return; }
  const roomId = created.room.id;
  const ticket = json(http.post(`${BASE}/api/party/sse-ticket`, JSON.stringify({ room_id: roomId, member_id: created.member_id, member_token: created.member_token }), { headers, tags: { kind: 'api' } }));
  // One SSE connection held open for a minute, like a viewer in the room.
  const res = http.get(`${BASE}/api/party/stream?room_id=${encodeURIComponent(roomId)}&last_msg_id=0&sse_ticket=${encodeURIComponent((ticket && ticket.sse_ticket) || '')}`, { headers: { Accept: 'text/event-stream' }, timeout: '60s', tags: { kind: 'sse' } });
  check(res, { 'sse answered': (r) => r.status === 200 || r.status === 0 });
  http.post(`${BASE}/api/party/leave`, JSON.stringify({ room_id: roomId, member_id: created.member_id, member_token: created.member_token }), { headers, tags: { kind: 'api' } });
}

export function remux() {
  const headers = session(200 + __VU);
  if (!headers) { sleep(5); return; }
  const episode = firstEpisode(headers);
  if (!episode) { sleep(10); return; }
  const avail = json(http.get(`${BASE}/api/stream/${encodeURIComponent(episode.id)}/availability?transcode=1&session=load${__VU}${RUN}`, { headers, tags: { kind: 'api' } }));
  if (avail && avail.busy) { busy.add(1); sleep(5); return; }
  // Read 30 s of the live stream (it is paced), then drop the connection like a closed player.
  http.get(`${BASE}/api/stream/${encodeURIComponent(episode.id)}?transcode=1&session=load${__VU}${RUN}`, { headers, timeout: '30s', tags: { kind: 'stream' } });
  sleep(2);
}
