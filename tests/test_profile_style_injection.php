<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';

echo "Running profile avatar/colour injection tests...\n";

function ps_status(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}

$db = Database::getConnection();
$user = 'ps_user_' . bin2hex(random_bytes(3));
$showId = 'ps_show_' . bin2hex(random_bytes(3));
$hostile = "https://a/');position:fixed;inset:0;z-index:99999;background-image:url('/library/avatars/uploads/x.jpg";

try {
    // 1. Pure helpers
    foreach (['#a855f7', '#FFFFFF', '#000000', '#12aB9f'] as $ok) {
        assert(DbHelper::isValidProfileColor($ok), "$ok is a valid colour");
    }
    foreach (['red', '#fff', '#12345', '#1234567', 'red;position:fixed', 'var(--accent-color)', "#12345'", '', null, ['#ffffff'], 123456] as $bad) {
        assert(!DbHelper::isValidProfileColor($bad), 'Invalid colour must be refused: ' . json_encode($bad));
    }
    assert(DbHelper::normalizeProfileColor('red;position:fixed') === '#a855f7', 'Stored junk is shown as the default colour');
    foreach (['/library/avatars/presets/preset_anime_boy.jpg', '/library/avatars/uploads/avatar_x_1a2b3c.png'] as $ok) {
        assert(DbHelper::normalizeAvatarUrl($ok) === $ok, "$ok is a valid avatar");
    }
    foreach ([$hostile, 'https://evil.example/x.png', '//evil.example/x.png', 'javascript:alert(1)', '/library/avatars/../../etc/passwd', '/library/avatars/a b.png',
              "/library/avatars/x'.png", '/library/avatars/x(1).png', '/library/Anime/show/poster.jpg', '/library/avatars/', 'data:image/png;base64,AAAA', str_repeat('a', 600), null, ['x']] as $bad) {
        assert(DbHelper::normalizeAvatarUrl($bad) === '', 'Invalid avatar must be dropped: ' . json_encode($bad));
    }
    echo "✓ Colour and avatar validators OK\n";

    // 2. Writing a profile
    DbHelper::registerUser($user, 'a_long_password_1', 'user');
    assert(ps_status(fn() => DbHelper::saveUserProfile($user, ['name' => 'Estilo', 'color' => 'red;position:fixed;inset:0'])) === 400, 'A colour that is not #RRGGBB is refused');
    assert(ps_status(fn() => DbHelper::saveUserProfile($user, ['name' => 'Estilo', 'color' => ['#ffffff']])) === 400, 'A non-string colour is refused');
    $p = DbHelper::saveUserProfile($user, ['name' => 'Estilo', 'color' => '#33AAcc', 'avatar' => $hostile]);
    assert($p['avatar'] === '', 'A hostile avatar URL is dropped');
    assert($p['avatar_color'] === '#33AAcc', 'A valid colour is stored');
    $p = DbHelper::saveUserProfile($user, ['id' => $p['id'], 'name' => 'Estilo', 'color' => '#33AAcc', 'avatar' => 'https://evil.example/track.png']);
    assert($p['avatar'] === '', 'External avatar URLs are not accepted (they would leak the viewer address)');
    $p = DbHelper::saveUserProfile($user, ['id' => $p['id'], 'name' => 'Estilo', 'color' => '#33AAcc', 'avatar' => '/library/avatars/presets/preset_anime_ninja.jpg']);
    assert($p['avatar'] === '/library/avatars/presets/preset_anime_ninja.jpg', 'A preset avatar is kept');
    echo "✓ saveUserProfile validates colour and avatar OK\n";

    // 3. Rows stored before this check (or edited directly) never reach clients as-is
    $db->prepare("UPDATE user_profiles SET avatar = :a, color = :c WHERE id = :id")->execute(['a' => $hostile, 'c' => 'red;position:fixed', 'id' => $p['id']]);
    foreach (DbHelper::getUserProfiles($user) as $row) {
        if ($row['id'] !== $p['id']) continue;
        assert($row['avatar'] === '' && $row['color'] === '#a855f7' && $row['avatar_color'] === '#a855f7', 'The profile list sanitises stored values');
    }
    DbHelper::saveShow(['id' => $showId, 'title' => 'Style Show', 'rating' => 7.0, 'year' => 2024, 'age_rating' => 'PG-13', 'genres' => 'Action']);
    DbHelper::addComment($showId, $user, 'Estilo', 'hola');
    $comments = DbHelper::getComments($showId);
    assert(count($comments) === 1, 'comment listed');
    assert($comments[0]['avatar'] === '' && $comments[0]['avatar_color'] === '#a855f7', 'Comments sanitise the commenter avatar/colour (public endpoint)');
    echo "✓ Stored hostile values are sanitised on the way out OK\n";
} finally {
    $db->prepare("DELETE FROM comments WHERE show_id = :s")->execute(['s' => $showId]);
    DbHelper::deleteShow($showId);
    $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $user]);
    $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $user]);
}

echo "All profile injection tests passed.\n";
