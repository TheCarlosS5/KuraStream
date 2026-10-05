<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/CalendarController.php';

echo "Running Calendar (airing only) Tests...\n";

$shows = [
    ['id' => 'a', 'title' => 'Frieren', 'status' => 'airing', 'poster_path' => '/p/a.jpg'],
    ['id' => 'b', 'title' => 'Grand Blue', 'status' => 'finished'],
    ['id' => 'c', 'title' => 'One Piece', 'status' => 'airing'],
    ['id' => 'd', 'title' => 'Mushoku Tensei', 'status' => 'upcoming'],
];
$now = gmmktime(17, 0, 0, 10, 4, 2026); // Sunday 2026-10-04 12:00 in Bogota
// Frieren was last seen by AniList three weeks ago on a Friday 09:00 Bogota time.
$friday = gmmktime(14, 0, 0, 9, 11, 2026);
$week = CalendarController::libraryAiringWeek($shows, ['a' => ['airing_at' => $friday]], $now);

$all = array_merge(...array_values($week));
$ids = array_column($all, 'library_show_id');
sort($ids);
assert($ids === ['a', 'c'], 'Only airing library shows appear (finished/upcoming never fill the week)');
assert(count($week['Friday']) === 1 && $week['Friday'][0]['library_show_id'] === 'a', 'A known slot keeps its weekday');
assert($week['Friday'][0]['airing_at'] > $now - 86400, 'The slot is projected onto the current week');
assert(count($week[CalendarController::UNSCHEDULED]) === 1 && $week[CalendarController::UNSCHEDULED][0]['library_show_id'] === 'c', 'Airing shows without a known day go under TBA');
assert($week['Friday'][0]['episode'] === null, 'No invented episode numbers offline');
foreach (CalendarController::DAYS as $day) assert(array_key_exists($day, $week), "Day key $day is always present");

echo "✓ Calendar airing-only tests passed\n";
