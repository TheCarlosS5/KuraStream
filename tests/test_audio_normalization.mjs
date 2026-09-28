import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { detectTrackLang, matchesLanguage } from '../frontend/player.js';

const source = fs.readFileSync(new URL('../frontend/js/main.js', import.meta.url), 'utf8');

// Extract showEpisodeDetails function
const body = source.match(/(?:export )?function showEpisodeDetails\([^\\n]*\{[\s\S]*?^\}/m);
assert.ok(body, 'Missing showEpisodeDetails');

// Setup mock context
function createTestContext(episodes) {
  const elements = new Map();
  const mockElement = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    style: { display: '' },
    dataset: {},
    querySelectorAll: function(selector) {
      if (selector === '.detail-pref-pill') {
        const matches = [];
        const btnRegex = /<button[^>]*class="([^"]*)"[^>]*data-track="([^"]*)"[^>]*data-lang="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g;
        let match;
        while ((match = btnRegex.exec(this.innerHTML)) !== null) {
          matches.push({
            className: match[1],
            getAttribute: (attr) => attr === 'data-track' ? match[2] : (attr === 'data-lang' ? match[3] : null),
            classList: {
              contains: (c) => match[1].includes(c),
              remove: () => {},
              add: () => {}
            },
            textContent: match[4].trim(),
            onclick: null
          });
        }
        return matches;
      }
      return [];
    }
  });

  const context = vm.createContext({
    console,
    currentShowEpisodes: episodes,
    document: {
      getElementById: (key) => {
        if (!elements.has(key)) elements.set(key, mockElement(key));
        return elements.get(key);
      }
    },
    escapeHtml: (str) => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
    escapeHtmlAttribute: (str) => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
    location: { hash: '' }
  });

  vm.runInContext(body[0].replace(/^export /, ''), context);
  return { context, elements };
}

test('normalizes raw GATON [SPA] and GATON [JPN] release tags to clean language names', () => {
  const episode = {
    id: 'ep1',
    episode_number: 1,
    season_number: 1,
    title: 'Capítulo 1',
    audio_tracks: [
      { track_number: 0, language: 'spa', title: 'GATON [SPA]' },
      { track_number: 1, language: 'jpn', title: 'GATON [JPN]' }
    ]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep1');

  const audioHtml = elements.get('ep-detail-audio').innerHTML;
  assert.ok(audioHtml.includes('Español'), 'Must include Español');
  assert.ok(audioHtml.includes('Japonés'), 'Must include Japonés');
  assert.ok(!audioHtml.includes('GATON'), 'Must not include GATON');
  assert.ok(!audioHtml.includes('[SPA]'), 'Must not include [SPA]');
  assert.ok(!audioHtml.includes('[JPN]'), 'Must not include [JPN]');
});

test('detects Latino dialect and English language correctly', () => {
  const episode = {
    id: 'ep2',
    episode_number: 2,
    season_number: 1,
    title: 'Capítulo 2',
    audio_tracks: [
      { track_number: 0, language: 'es-la', title: 'GATON' },
      { track_number: 1, language: 'eng', title: 'GATON [ENG]' }
    ]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep2');

  const audioHtml = elements.get('ep-detail-audio').innerHTML;
  assert.ok(audioHtml.includes('Español Latino'), 'Must detect Español Latino');
  assert.ok(audioHtml.includes('Inglés'), 'Must detect Inglés');
  assert.ok(!audioHtml.includes('GATON'), 'Must not include GATON');
});

test('handles missing language code when title contains language cues', () => {
  const episode = {
    id: 'ep3',
    episode_number: 3,
    season_number: 1,
    title: 'Capítulo 3',
    audio_tracks: [
      { track_number: 0, language: 'und', title: '[GATON] [SPA] Audio' },
      { track_number: 1, language: '', title: '[Erai-raws] Japanese' }
    ]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep3');

  const audioHtml = elements.get('ep-detail-audio').innerHTML;
  assert.ok(audioHtml.includes('Español'), 'Must infer Español from [SPA]');
  assert.ok(audioHtml.includes('Japonés'), 'Must infer Japonés from Japanese');
});

test('subtitles element is cleared in episode detail modal', () => {
  const episode = {
    id: 'ep4',
    episode_number: 4,
    season_number: 1,
    title: 'Capítulo 4',
    audio_tracks: [{ track_number: 0, language: 'spa', title: 'Audio' }],
    subtitle_tracks: [{ track_number: 0, language: 'spa', title: 'Sub' }]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep4');

  assert.equal(elements.get('ep-detail-subtitles').innerHTML, '', 'Subtitles must be empty in episode detail modal');
});

test('play button triggers hash navigation with encoded episode ID', () => {
  const episode = {
    id: 'show_part/1_S1_E1',
    episode_number: 1,
    season_number: 1,
    title: 'Capítulo 1',
    audio_tracks: [{ track_number: 0, language: 'spa', title: 'Español' }]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('show_part/1_S1_E1');

  const playBtn = elements.get('ep-detail-play-btn');
  assert.ok(typeof playBtn.onclick === 'function', 'Play button should have click listener');
  playBtn.onclick();

  assert.equal(context.location.hash, '#/player/show_part%2F1_S1_E1');
});

test('disambiguates identical channel tracks so buttons are never duplicated', () => {
  const episode = {
    id: 'ep5',
    episode_number: 5,
    season_number: 1,
    title: 'Capítulo 5',
    audio_tracks: [
      { track_number: 1, channels: 2, language: 'spa', title: 'Audio 1' },
      { track_number: 2, channels: 2, language: 'spa', title: 'Audio 2' }
    ]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep5');

  const pills = elements.get('ep-detail-audio').querySelectorAll('.detail-pref-pill');
  assert.equal(pills.length, 2);
  assert.notEqual(pills[0].textContent, pills[1].textContent, 'Pills must have distinct text');
  assert.ok(pills[0].textContent.includes('1'), 'Pill 1 should include index qualifier');
  assert.ok(pills[1].textContent.includes('2'), 'Pill 2 should include index qualifier');
});

test('disambiguates different channel tracks with 5.1 and Estéreo', () => {
  const episode = {
    id: 'ep6',
    episode_number: 6,
    season_number: 1,
    title: 'Capítulo 6',
    audio_tracks: [
      { track_number: 1, channels: 6, language: 'spa', title: 'Audio Surround' },
      { track_number: 2, channels: 2, language: 'spa', title: 'Audio Stereo' }
    ]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep6');

  const pills = elements.get('ep-detail-audio').querySelectorAll('.detail-pref-pill');
  assert.equal(pills.length, 2);
  assert.equal(pills[0].textContent, 'Español (5.1)');
  assert.equal(pills[1].textContent, 'Español (Estéreo)');
});

test('handles BCP-47 regional Spanish codes (es-MX, es-AR, es-ES)', () => {
  const episode = {
    id: 'ep7',
    episode_number: 7,
    season_number: 1,
    title: 'Capítulo 7',
    audio_tracks: [
      { track_number: 0, language: 'es-MX', title: '' },
      { track_number: 1, language: 'es-ES', title: '' }
    ]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep7');

  const pills = elements.get('ep-detail-audio').querySelectorAll('.detail-pref-pill');
  assert.equal(pills.length, 2);
  assert.equal(pills[0].textContent, 'Español Latino');
  assert.equal(pills[1].textContent, 'Español (España)');
});

test('handles title cues [ESP] and [LAT]', () => {
  const episode = {
    id: 'ep8',
    episode_number: 8,
    season_number: 1,
    title: 'Capítulo 8',
    audio_tracks: [
      { track_number: 0, language: 'und', title: '[GATON] [ESP]' },
      { track_number: 1, language: 'und', title: '[GATON] [LAT]' }
    ]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep8');

  const pills = elements.get('ep-detail-audio').querySelectorAll('.detail-pref-pill');
  assert.equal(pills.length, 2);
  assert.equal(pills[0].textContent, 'Español');
  assert.equal(pills[1].textContent, 'Español Latino');
});

test('cleans release groups in title when no language is present', () => {
  const episode = {
    id: 'ep9',
    episode_number: 9,
    season_number: 1,
    title: 'Capítulo 9',
    audio_tracks: [
      { track_number: 0, language: 'und', title: '[GATON] Commentary Track' }
    ]
  };

  const { context, elements } = createTestContext([episode]);
  context.showEpisodeDetails('ep9');

  const pills = elements.get('ep-detail-audio').querySelectorAll('.detail-pref-pill');
  assert.equal(pills.length, 1);
  assert.equal(pills[0].textContent, 'Commentary Track');
  assert.ok(!pills[0].textContent.includes('GATON'));
});

test('player detectTrackLang and matchesLanguage helpers handle und with title cues', () => {
  const trackSpa = { language: 'und', title: 'GATON [SPA]' };
  const trackJpn = { language: 'ja', title: 'Japanese Audio' };
  const trackMex = { language: 'es-MX', title: '' };

  assert.equal(detectTrackLang(trackSpa), 'spa');
  assert.equal(detectTrackLang(trackJpn), 'jpn');
  assert.equal(detectTrackLang(trackMex), 'es-la');

  assert.ok(matchesLanguage(detectTrackLang(trackSpa), 'spa'));
  assert.ok(matchesLanguage(detectTrackLang(trackSpa), 'es'));
  assert.ok(matchesLanguage(detectTrackLang(trackMex), 'spa'));
  assert.ok(matchesLanguage(detectTrackLang(trackJpn), 'jpn'));
  assert.ok(!matchesLanguage(detectTrackLang(trackSpa), 'jpn'));
  assert.ok(!matchesLanguage('und', 'spa'));
});
