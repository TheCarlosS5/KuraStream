import { dbHelper } from './db.js';

let calendarCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function fetchWeeklyCalendar(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && calendarCache && (now - lastCacheTime < CACHE_TTL_MS)) {
    return attachLibraryMatches(calendarCache);
  }

  try {
    const startOfWeek = Math.floor(now / 1000) - (24 * 3600); // 1 day ago
    const endOfWeek = Math.floor(now / 1000) + (7 * 24 * 3600); // 7 days ahead

    const query = `
      query ($start: Int, $end: Int) {
        Page(page: 1, perPage: 50) {
          airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
            id
            airingAt
            timeUntilAiring
            episode
            media {
              id
              title { romaji english native }
              coverImage { extraLarge large }
              bannerImage
              genres
              studios(isMain: true) { nodes { name } }
            }
          }
        }
      }
    `;

    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        query,
        variables: { start: startOfWeek, end: endOfWeek }
      })
    });

    if (!res.ok) {
      throw new Error(`AniList HTTP ${res.status}`);
    }

    const data = await res.json();
    const schedules = data.data?.Page?.airingSchedules || [];

    const daysMap = {
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
      Sunday: []
    };

    const daysNameEs = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    schedules.forEach(item => {
      if (!item.media) return;
      const date = new Date(item.airingAt * 1000);
      const dayName = daysNameEs[date.getDay()];
      
      const titleObj = item.media.title || {};
      const displayTitle = titleObj.spanish || titleObj.english || titleObj.romaji || titleObj.native || 'Anime';
      const cover = item.media.coverImage?.extraLarge || item.media.coverImage?.large || '';
      const studios = (item.media.studios?.nodes || []).map(s => s.name).join(', ');

      if (daysMap[dayName]) {
        daysMap[dayName].push({
          schedule_id: item.id,
          airing_at: item.airingAt,
          time_until: item.timeUntilAiring,
          episode: item.episode,
          title: displayTitle,
          romaji_title: titleObj.romaji || '',
          english_title: titleObj.english || '',
          cover_image: cover,
          banner_image: item.media.bannerImage || '',
          genres: (item.media.genres || []).join(', '),
          studio: studios
        });
      }
    });

    calendarCache = daysMap;
    lastCacheTime = now;
    return attachLibraryMatches(calendarCache);

  } catch (err) {
    console.error("Failed to fetch AniList schedule:", err.message);
    // If cache exists return cached even if expired
    if (calendarCache) return attachLibraryMatches(calendarCache);
    return {
      Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: []
    };
  }
}

function attachLibraryMatches(scheduleData) {
  const localShows = dbHelper.getShows('anime');
  const result = {};

  for (const [day, items] of Object.entries(scheduleData)) {
    result[day] = items.map(item => {
      const match = localShows.find(s => {
        const titleLower = s.title.toLowerCase();
        return (
          titleLower.includes(item.title.toLowerCase()) ||
          (item.romaji_title && titleLower.includes(item.romaji_title.toLowerCase())) ||
          (item.english_title && titleLower.includes(item.english_title.toLowerCase()))
        );
      });

      return {
        ...item,
        in_library: Boolean(match),
        library_show_id: match ? match.id : null
      };
    });
  }

  return result;
}
