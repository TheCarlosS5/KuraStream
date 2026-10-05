/**
 * Audio / subtitle track helpers shared by the web player.
 * Releases often carry "und" language codes and group tags ("GATON", "[SPA]"), so the language
 * is resolved from the code first and from the title as a fallback.
 */

const LANGUAGE_LABELS = {
  'es-la': 'Español (Latino)',
  es: 'Español (España)',
  spa: 'Español',
  jpn: 'Japonés',
  eng: 'Inglés',
  fra: 'Francés',
  deu: 'Alemán',
  ita: 'Italiano',
  por: 'Portugués',
  kor: 'Coreano',
  zho: 'Chino',
  rus: 'Ruso'
};

const CODE_ALIASES = [
  ['fra', /^(?:fra|fre|fr|fr[-_](?:fr|ca)|french)$/i],
  ['deu', /^(?:deu|ger|de|de[-_](?:de|at|ch)|german)$/i],
  ['ita', /^(?:ita|it|it[-_]it|italian)$/i],
  ['por', /^(?:por|pt|pt[-_](?:br|pt)|portuguese)$/i],
  ['kor', /^(?:kor|ko|ko[-_]kr|korean)$/i],
  ['zho', /^(?:zho|chi|zh|zh[-_](?:cn|tw|hk)|chinese)$/i],
  ['rus', /^(?:rus|ru|ru[-_]ru|russian)$/i]
];

const TITLE_CUES = [
  ['es-la', /\b(latino|lat|es-la|es-419|hispanoam[eé]rica|mexico|m[eé]xico)\b/i],
  ['es', /\b(castellano|espa[nñ]a|spain|es-es)\b/i],
  ['spa', /(?:^|[_\s\-[(/])(?:spa|esp|es|spanish|espa[nñ]ol)(?:$|[_\s\-\])/])|\b(?:spanish|espa[nñ]ol)\b/i],
  ['jpn', /(?:^|[_\s\-[(/])(?:jpn|jap|ja|japanese|japon[eé]s)(?:$|[_\s\-\])/])|\b(?:japanese|japon[eé]s)\b/i],
  ['eng', /(?:^|[_\s\-[(/])(?:eng|en|english|ingl[eé]s)(?:$|[_\s\-\])/])|\b(?:english|ingl[eé]s)\b/i]
];

const SPANISH = ['spa', 'es', 'es-es', 'es-la', 'es-419', 'spanish', 'español', 'castellano', 'lat'];
const ENGLISH = ['eng', 'en', 'en-us', 'en-gb', 'english', 'inglés'];
const JAPANESE = ['jpn', 'ja', 'japanese', 'japonés'];

const BITMAP_CODECS = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'pgssub', 'dvdsub'];

export function parseTrackList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return Object.values(parsed);
    } catch {
      return [];
    }
  }
  if (typeof value === 'object') return Object.values(value);
  return [];
}

/** Number the stream endpoint understands for this track (track_number, then index, then position). */
export function trackNumber(track, position = 0) {
  if (track && typeof track === 'object') {
    if (track.track_number !== undefined && track.track_number !== null) return Number(track.track_number);
    if (track.index !== undefined && track.index !== null) return Number(track.index);
  }
  return position;
}

export function detectTrackLang(track) {
  if (!track) return 'und';
  const rawLang = String(track.language || track.lang || '').toLowerCase().trim();
  if (/^(?:es[-_](?:la|419|mx|ar|co|cl|pe|us|uy|ve|ec|gt|cu|bo|do|hn|py|sv|ni|cr|pa|pr)|lat)$/i.test(rawLang)) return 'es-la';
  if (/^(?:es[-_]es)$/i.test(rawLang)) return 'es';
  if (/^(?:spa|es|spanish|espa[nñ]ol)$/i.test(rawLang) || rawLang.startsWith('es-') || rawLang.startsWith('es_')) return 'spa';
  if (/^(?:jpn|ja|ja[-_]jp|japanese)$/i.test(rawLang)) return 'jpn';
  if (/^(?:eng|en|en[-_](?:us|gb|ca|au|nz)|english)$/i.test(rawLang)) return 'eng';
  for (const [code, pattern] of CODE_ALIASES) {
    if (pattern.test(rawLang)) return code;
  }
  if (rawLang && rawLang !== 'und') return rawLang;

  const title = String(track.title || track.name || track.label || '').toLowerCase();
  for (const [code, pattern] of TITLE_CUES) {
    if (pattern.test(title)) return code;
  }
  return 'und';
}

export function matchesLanguage(trackLang, prefLang) {
  if (!trackLang || !prefLang) return false;
  const t = String(trackLang).toLowerCase().trim();
  const p = String(prefLang).toLowerCase().trim();
  if (p === 'default' || p === 'off' || t === 'und') return false;
  if (t === p) return true;
  if (SPANISH.includes(p) && SPANISH.includes(t)) return true;
  if (ENGLISH.includes(p) && ENGLISH.includes(t)) return true;
  if (JAPANESE.includes(p) && JAPANESE.includes(t)) return true;
  return t.startsWith(p) || p.startsWith(t);
}

export function isBitmapSubtitle(track) {
  return Boolean(track && (track.is_bitmap || BITMAP_CODECS.includes(String(track.codec || '').toLowerCase())));
}

function isForcedSubtitle(track) {
  const title = String(track && track.title || '').toLowerCase();
  return Boolean(track && track.disposition && track.disposition.forced) || /\b(forced|forzados?|signs|carteles)\b/.test(title);
}

export function languageLabel(code) {
  if (!code || code === 'und') return '';
  return LANGUAGE_LABELS[code] || code.toUpperCase();
}

function channelLabel(track) {
  const ch = Number(track && track.channels);
  if (ch === 6) return '5.1';
  if (ch === 8) return '7.1';
  if (ch === 2) return 'Estéreo';
  if (ch === 1) return 'Mono';
  return ch > 0 ? `${ch} canales` : '';
}

/** Group tags and brackets stripped from a release title ("[GATON] Español" -> "Español"). */
function cleanReleaseTitle(title) {
  return String(title || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(?:gaton|erai-raws|subsplease|horriblesubs|judas|ember|asw|puya|crunchyroll|netflix|animetime)\b/gi, '')
    .replace(/^pista\s+\d+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Human labels for a list of tracks: language first, then the cleaned release title or the
 * channel layout to tell apart tracks that share a language.
 */
export function labelTracks(tracks, kind = 'audio') {
  const base = tracks.map((track, position) => {
    const lang = detectTrackLang(track);
    const cleaned = cleanReleaseTitle(track && track.title);
    let label = languageLabel(lang) || cleaned || `${kind === 'audio' ? 'Audio' : 'Subtítulos'} ${position + 1}`;
    const hints = [];
    if (kind === 'subtitle' && isForcedSubtitle(track)) hints.push('Forzados');
    if (kind === 'audio' && /commentary|comentario/i.test(cleaned)) hints.push('Comentarios');
    return { track, position, lang, cleaned, label, hints };
  });

  const counts = new Map();
  base.forEach(item => counts.set(item.label, (counts.get(item.label) || 0) + 1));
  base.forEach(item => {
    if (counts.get(item.label) > 1) {
      const detail = kind === 'audio' ? channelLabel(item.track) : '';
      const extra = item.cleaned && item.cleaned !== item.label ? item.cleaned : detail;
      if (extra) item.hints.push(extra);
    }
  });
  // Still identical after the hints: number them.
  const seen = new Map();
  base.forEach(item => {
    const full = [item.label, ...item.hints].join(' · ');
    if (counts.get(item.label) > 1) {
      const n = (seen.get(full) || 0) + 1;
      seen.set(full, n);
      if (base.filter(other => [other.label, ...other.hints].join(' · ') === full).length > 1) item.hints.push(String(n));
    }
  });

  return base.map(item => ({
    number: trackNumber(item.track, item.position),
    lang: item.lang,
    label: item.label,
    detail: item.hints.join(' · '),
    bitmap: kind === 'subtitle' && isBitmapSubtitle(item.track),
    forced: kind === 'subtitle' && isForcedSubtitle(item.track),
    track: item.track
  }));
}

/**
 * Audio track to start with: an explicit pick from the episode modal, then the preferred
 * language, then the file's default track, then the first one.
 */
export function chooseAudioTrack(tracks, { explicit = null, preferred = 'default' } = {}) {
  if (!tracks.length) return 0;
  if (explicit !== null && explicit !== undefined && !Number.isNaN(Number(explicit))) {
    const wanted = Number(explicit);
    const byNumber = tracks.find((t, i) => trackNumber(t, i) === wanted);
    if (byNumber) return trackNumber(byNumber, tracks.indexOf(byNumber));
  }
  let match = null;
  if (preferred && preferred !== 'default') {
    match = tracks.find(t => matchesLanguage(detectTrackLang(t), preferred));
  }
  if (!match) match = tracks.find(t => t && t.disposition && t.disposition.default) || tracks[0];
  return trackNumber(match, tracks.indexOf(match));
}

/**
 * Subtitle track to start with (-1 = off). Text tracks only. When the audio is already in the
 * viewer's language (a dub), full subtitles in that same language are skipped; forced/signs
 * tracks are still used.
 */
export function chooseSubtitleTrack(tracks, { preferred = 'default', audioLang = 'und' } = {}) {
  const text = tracks.filter(t => !isBitmapSubtitle(t));
  if (!text.length || preferred === 'off') return -1;
  const target = preferred && preferred !== 'default' ? preferred : 'spa';
  const sameAsAudio = matchesLanguage(audioLang, target);
  const inTarget = text.filter(t => matchesLanguage(detectTrackLang(t), target));

  let match = null;
  if (sameAsAudio) {
    match = inTarget.find(isForcedSubtitle) || null;
  } else {
    // Foreign audio with no subtitles in the viewer's language: the file's default track beats none.
    match = inTarget.find(t => !isForcedSubtitle(t)) || inTarget[0]
      || text.find(t => t && t.disposition && t.disposition.default && !isForcedSubtitle(t)) || null;
  }
  return match ? trackNumber(match, tracks.indexOf(match)) : -1;
}

/**
 * The preferred audio/subtitle language, resolved the same way everywhere (episode page, player, settings):
 * this device's choice first, then the profile's saved preference, then 'default' (the file's own default track).
 * Before this each place had its own fallback ('spa', 'jpn' and 'default').
 */
export function readLanguagePrefs(storage, serverPrefs = null) {
  const read = (...keys) => {
    for (const key of keys) {
      try {
        const value = storage && storage.getItem(key);
        if (value) return value;
      } catch { /* storage blocked */ }
    }
    return null;
  };
  const server = serverPrefs || {};
  return {
    audio: read('kura_pref_audio_lang', 'kurastream_preferred_audio_language') || server.preferred_audio_language || 'default',
    subtitle: read('kura_pref_sub_lang', 'kurastream_preferred_subtitle_language') || server.preferred_subtitle_language || 'default'
  };
}
