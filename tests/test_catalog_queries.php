<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/services/SeasonSync.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running catalogue query tests (SQL filters, paging, ETag, random, show lookup, stale seasons)...\n";

$db = Database::getConnection();
$s = bin2hex(random_bytes(3));
$ids = [];
$mk = function (string $slug, array $over = []) use (&$ids, $s) {
    $id = "cq_{$slug}_$s";
    $ids[] = $id;
    DbHelper::saveShow($over + ['id' => $id, 'title' => "CQ $slug $s", 'type' => 'anime', 'folder' => $slug, 'rating' => 7.0, 'year' => 2020,
        'genres' => 'Action', 'age_rating' => 'TV-14', 'status' => 'finished', 'media_type' => 'anime', 'cast_members' => [['name' => 'X']]]);
    return $id;
};
$server = null;
try {
    $a = $mk('alpha', ['year' => 2021, 'rating' => 9.1, 'status' => 'airing']);
    $b = $mk('bravo', ['year' => 2019, 'rating' => 5.5]);
    $c = $mk('charlie', ['age_rating' => 'TV-MA', 'year' => 2023]);
    $d = $mk('delta', ['genres' => 'Comedy, Ecchi', 'year' => 2022]);
    $e = $mk('echo', ['media_type' => 'movie', 'year' => 2018, 'age_rating' => 'PG']);
    $mine = fn(array $items) => array_values(array_filter($items, fn($x) => in_array($x['id'], $GLOBALS['ids'], true)));
    $idsOf = fn(array $items) => array_column($mine($items), 'id');

    // 1. Filters and sorts happen in SQL
    $all = DbHelper::getCatalogShows([])['items'];
    assert(count($mine($all)) === 5, 'all five fixtures listed');
    assert(!array_key_exists('cast_members', $all[0]), 'the list leaves out cast_members (detail only)');
    assert($idsOf(DbHelper::getCatalogShows(['type' => 'movie'])['items']) === [$e], 'type filter');
    assert($idsOf(DbHelper::getCatalogShows(['status' => 'airing'])['items']) === [$a], 'status filter');
    assert(count($idsOf(DbHelper::getCatalogShows(['status' => 'finished', 'type' => 'anime'])['items'])) === 3, 'combined filters');
    $kids = $idsOf(DbHelper::getCatalogShows(['kids' => true])['items']);
    assert(!in_array($c, $kids, true) && !in_array($d, $kids, true) && in_array($a, $kids, true) && in_array($e, $kids, true), 'kids profiles never see TV-MA or ecchi titles');
    $byRating = $idsOf(DbHelper::getCatalogShows(['sort' => 'rating_desc'])['items']);
    assert($byRating[0] === $a, 'sorted by rating, best first');
    $byYear = $idsOf(DbHelper::getCatalogShows(['sort' => 'year_asc'])['items']);
    assert($byYear[0] === $e && end($byYear) === $c, 'sorted by year');
    $byTitle = $idsOf(DbHelper::getCatalogShows(['sort' => 'title_asc'])['items']);
    assert($byTitle === [$a, $b, $c, $d, $e], 'sorted by title');

    // 2. Paging and totals
    $page = DbHelper::getCatalogShows(['sort' => 'title_asc', 'limit' => 2, 'offset' => 0]);
    assert(count($page['items']) === 2 && $page['total'] >= 5, 'a page has its size and the total counts everything');
    $big = DbHelper::getCatalogShows(['limit' => 100000]);
    assert(count($big['items']) <= 1000, 'a page is capped');
    echo "✓ SQL filtering, sorting and paging OK\n";

    // 3. Random show: one row from SQL, kids-safe on request
    for ($i = 0; $i < 15; $i++) {
        $r = DbHelper::getRandomShow(true);
        assert($r && !in_array($r['id'], [$c, $d], true), 'random for kids never returns restricted shows');
    }
    assert(is_array(DbHelper::getRandomShow(false)), 'random works');

    // 4. Lookup: exact matches beat loose ones, loose still works
    $exact = DbHelper::findShowByFolderOrTitle("cq_bravo_$s", 'nothing');
    assert($exact && $exact['id'] === $b, 'folder equal to an id is found');
    $byTitle = DbHelper::findShowByFolderOrTitle('zzz', "cq charlie $s");
    assert($byTitle && $byTitle['id'] === $c, 'title match is case-insensitive');
    $loose = DbHelper::findShowByFolderOrTitle("cq delta $s", 'x');
    assert($loose && $loose['id'] === $d, 'a folder name matches a title through the looser pattern');
    assert(DbHelper::findShowByFolderOrTitle("nope_$s", "nada $s") === null, 'nothing found stays null');
    echo "✓ Random show and lookup OK\n";

    // 5. Stale-season detection without a query per show
    $db->prepare("DELETE FROM show_seasons WHERE show_id = :s")->execute(['s' => $a]);
    DbHelper::saveEpisode(['id' => "{$a}_S1_E1", 'show_id' => $a, 'season_number' => 1, 'episode_number' => 1, 'title' => 'e', 'filepath' => '/tmp/none.mkv', 'duration' => 1, 'size' => 1,
        'video_codec' => '', 'resolution' => '', 'fps' => 0, 'audio_tracks' => [], 'subtitle_tracks' => [], 'thumbnail_path' => '', 'chapters' => []]);
    assert(in_array($a, SeasonSync::staleShowIds(), true), 'a show whose season was never synced is stale');
    $db->prepare("INSERT INTO show_seasons (show_id, season_number, name, synced_at) VALUES (:s, 1, 'T1', UTC_TIMESTAMP())")->execute(['s' => $a]);
    assert(!in_array($a, SeasonSync::staleShowIds(), true), 'a season synced just now is fresh');
    $db->prepare("UPDATE show_seasons SET synced_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 DAY) WHERE show_id = :s")->execute(['s' => $a]);
    assert(in_array($a, SeasonSync::staleShowIds(), true), 'an airing show is stale after a day');
    $db->prepare("UPDATE shows SET status = 'finished' WHERE id = :s")->execute(['s' => $a]);
    assert(!in_array($a, SeasonSync::staleShowIds(), true), 'a finished one only after two weeks');
    echo "✓ Stale season detection OK\n";

    // 5b. Episodes whose file went missing are flagged (and never offered as "next episode")
    assert(DbHelper::serializeEpisodeForClient(['id' => 'x', 'availability_status' => 'missing'])['available'] === false, 'a missing episode is flagged unavailable');
    assert(DbHelper::serializeEpisodeForClient(['id' => 'x'])['available'] === true, 'and an ordinary one is available');
    echo "✓ Missing episodes flagged OK\n";

    // 6. Over HTTP: ETag / 304, X-Total-Count, a single copy of the episodes in the detail payload
    [$server, $port] = kura_start_server();
    [$code, $h, $json] = kura_http($port, 'GET', '/api/shows?type=movie&limit=1');
    assert($code === 200 && isset($h['etag']) && ($h['cache-control'] ?? '') === 'private, no-cache' && isset($h['x-total-count']), 'the list carries an ETag and the total');
    [$code2, , , $raw] = kura_http($port, 'GET', '/api/shows?type=movie&limit=1', null, null, 'If-None-Match: ' . $h['etag'] . "\r\n");
    assert($code2 === 304 && $raw === '', 'an unchanged list answers 304 with no body');
    [$code3] = kura_http($port, 'GET', '/api/shows?type=movie&limit=1', null, null, "If-None-Match: \"stale\"\r\n");
    assert($code3 === 200, 'a different ETag gets the list');
    [$code, $h, $detail, $raw] = kura_http($port, 'GET', '/api/shows/' . $a);
    assert($code === 200 && isset($detail['episodes'], $detail['seasons'], $detail['season_info'], $detail['show']['title']) && !isset($detail['show']['episodes']), 'detail: show metadata once, episodes once at the top level');
    assert(substr_count($raw, '"id":"' . $a . '_S1_E1"') === 2, 'each episode appears twice (list and per-season grouping), not four times');
    [$code4] = kura_http($port, 'GET', '/api/shows/' . $a, null, null, 'If-None-Match: ' . $h['etag'] . "\r\n");
    assert($code4 === 304, 'the detail revalidates too');
    echo "✓ ETag revalidation and lean detail payload OK\n";
} finally {
    kura_stop_server($server);
    foreach ($ids as $id) { DbHelper::deleteShow($id); }
}
echo "All catalogue query tests passed.\n";
